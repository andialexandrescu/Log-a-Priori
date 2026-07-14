# silhouette/ Davies–Bouldin/ purity
from __future__ import annotations
import argparse
import json
import math
import os
import sys
import importlib
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
import numpy as np
import pandas as pd
import torch
import matplotlib.pyplot as plt
import networkx as nx
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import davies_bouldin_score, silhouette_score
from sklearn.feature_extraction.text import TfidfVectorizer
from scipy.stats import ttest_rel, wilcoxon
from tabulate import tabulate
from transformers import AutoModel, AutoTokenizer
from train_unsupervised_dgi import load_graph_bundle, MultiGraphEncoder
from eval_plot_utils import style_project_xaxis, project_sort_key

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"
DEFAULT_ANALYSIS_SUBDIR = "analysis"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# finetuned dgi embeddings are properly shaped, i only need to tune the granularity
# defining search grids for hierarchical clustering => sweep grid for finetuned dgi embeddings
# the actual defaults used when comparing methods are top=0.34, sub=0.22, min_cluster_size=4
DEFAULT_TOP_THRESHOLDS = [0.28, 0.30, 0.32, 0.34, 0.36, 0.38] # looser/ larger clusters meant for feature areas

DEFAULT_UNSUPERVISED_TOP_THRESHOLDS = [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32, 0.34] # wider sweep for unsupervised dgi
# the script sweeps 0.04-0.34 in order to find a threshold where silhouette/ Davies–Bouldin/ purity look reasonable

DEFAULT_SUB_THRESHOLDS = [0.16, 0.18, 0.20, 0.22, 0.24, 0.26] # low threshold indicates tight/ small cluster and they are used to split top clusters once again
DEFAULT_MIN_CLUSTER_SIZE = 4 # subclusters with fewer nodes than are dropped DEFAULT_MIN_CLUSTER_SIZE

# the best unsupervised threshold is picked per project via select_best_sweep_candidate

CODEBERT_MODEL_ID = "microsoft/codebert-base"

def normalize_file_path(value):
    if not value:
        return ""
    return value.replace("\\", "/").strip().lstrip("/")

def extract_module_prefix(file_path): # normalizing file paths into a module label for purity scoring
    normalized = normalize_file_path(file_path)
    if not normalized:
        return "unknown"
    
    parts = normalized.split("/")
    if len(parts) >= 3 and parts[0] in {"app", "features", "lib", "components", "workflow-app"}:
        return "/".join(parts[:2])
    if len(parts) >= 2:
        return parts[0]
    return normalized

def discover_projects():
    projects = []
    for project_dir in sorted(BASE_DIR.glob("*")):
        if not project_dir.is_dir():
            continue
        if list(project_dir.glob("preprocessed-graph-*.pkl")):
            projects.append(project_dir)
    return projects

def find_project_pickles(project_root):
    return sorted(project_root.glob("preprocessed-graph-*.pkl"))

def dump_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

def load_encoder(sample_pkl, prefer_finetuned = True):
    sample_data, _, _ = load_graph_bundle(sample_pkl)
    in_channels = int(sample_data.num_features)

    finetuned_path = BASE_DIR / "finetuned_inductive_dgi_encoder.pt"
    unsupervised_path = BASE_DIR / "unsupervised_inductive_dgi_encoder.pt"
    projection_head_path = BASE_DIR / "node_projection_head.pt"

    if prefer_finetuned and finetuned_path.exists():
        ckpt = torch.load(finetuned_path, map_location=DEVICE)
        source_path = finetuned_path
    elif unsupervised_path.exists():
        ckpt = torch.load(unsupervised_path, map_location=DEVICE)
        source_path = unsupervised_path
    elif finetuned_path.exists():
        ckpt = torch.load(finetuned_path, map_location=DEVICE)
        source_path = finetuned_path
    else:
        raise FileNotFoundError("No DGI encoder checkpoint found in AppData folder")

    hidden_channels = int(ckpt["mp1.lin.weight"].shape[0])
    out_channels = int(ckpt["mp3.lin.weight"].shape[0])
    use_batch_norm = any(".bn." in key for key in ckpt.keys())

    encoder = MultiGraphEncoder(in_channels, hidden_channels, out_channels, use_input_proj=True, use_batch_norm=use_batch_norm).to(DEVICE)
    encoder.load_state_dict(ckpt)
    encoder.eval()

    projection_head = None
    if projection_head_path.exists() and source_path.name.startswith("finetuned"):
        try:
            from train_finetuned_dgi import ProjectionHead
            projection_state = torch.load(projection_head_path, map_location=DEVICE)
            projection_hidden_dim = int(projection_state["net.0.weight"].shape[0])
            projection_head = ProjectionHead(out_channels, projection_hidden_dim, out_channels).to(DEVICE)
            projection_head.load_state_dict(projection_state)
            projection_head.eval()
        except Exception as exc:
            print(f"[DGI] Projection head skipped: {exc}")
            projection_head = None

    return encoder, projection_head, {
        "source_path": str(source_path),
        "in_channels": in_channels,
        "hidden_channels": hidden_channels,
        "out_channels": out_channels,
        "use_batch_norm": use_batch_norm,
    }

@torch.no_grad()
def compute_dgi_embeddings(pkl_path, encoder, projection_head): # running the graph encoder
    data, node_list, _ = load_graph_bundle(pkl_path)
    x = data.x.to(DEVICE)
    edge_index = data.edge_index.to(DEVICE)

    node_embs = encoder(x, edge_index)
    if projection_head is not None:
        node_embs = projection_head(node_embs)
        
    emb_matrix = node_embs.detach().cpu().numpy().astype(np.float32)
    return emb_matrix, node_list, edge_index

def cluster_embeddings(embeddings, distance_threshold): # using hierarchical clustering with cosine distance so the threshold directly controls cluster granularity
    if embeddings.shape[0] == 0:
        return np.asarray([], dtype=int)
    model = AgglomerativeClustering(n_clusters=None, linkage="average", metric="cosine", distance_threshold=distance_threshold)
    return model.fit_predict(embeddings)

def cluster_metrics(embeddings, node_list, labels, edge_index = None): # computing cluster quality, purity and graph local density signals
    n = int(embeddings.shape[0])
    result = {"n_nodes": n, "n_clusters": int(len(set(labels.tolist()))) if labels.size else 0}

    try:
        if labels.size and len(set(labels.tolist())) >= 2 and len(set(labels.tolist())) < n:
            result["silhouette"] = float(silhouette_score(embeddings, labels, metric="cosine"))
            result["davies_bouldin"] = float(davies_bouldin_score(embeddings, labels))
        else:
            result["silhouette"] = None
            result["davies_bouldin"] = None
    except Exception as exc:
        result["silhouette_error"] = str(exc)
        result["davies_bouldin_error"] = str(exc)

    modules = [extract_module_prefix(node.get("file") or node.get("repoRelativePath") or "") for node in node_list]
    cluster_to_modules: Dict[int, List[str]] = defaultdict(list)
    for label, module in zip(labels.tolist() if labels.size else [], modules):
        cluster_to_modules[int(label)].append(module)
    total = 0
    matched = 0
    for mods in cluster_to_modules.values():
        if not mods:
            continue
        counter = Counter(mods)
        matched += counter.most_common(1)[0][1]
        total += len(mods)
    result["purity"] = float(matched / total) if total else 0.0

    if edge_index is not None:
        try:
            result.update(edge_density_metrics(edge_index, labels))
        except Exception as exc:
            result["density_error"] = str(exc)
    else:
        result["within_cluster_edge_density"] = None
        result["cross_cluster_edge_fraction"] = None

    return result

def sweep_candidate_score(item): # the desired scores are higher for silhouette, lower for db and higher for purity
    silhouette = item.get("silhouette")
    davies_bouldin = item.get("davies_bouldin")
    purity = item.get("purity")
    if silhouette is None or davies_bouldin is None or purity is None:
        return None
    return (float(silhouette), -float(davies_bouldin), float(purity))

def select_best_sweep_candidate(results): # keeping the best threshold candidate which is also valid
    valid_candidates = []
    for item in results:
        if "error" in item:
            continue
        score = sweep_candidate_score(item)
        if score is None:
            continue
        valid_candidates.append((score, item))
    if not valid_candidates:
        return None
    return max(valid_candidates, key=lambda pair: pair[0])[1]

def build_hierarchical_labels(embeddings, top_threshold, sub_threshold, min_cluster_size): # the first clusters are on a larger scale, followed by splitting large clusters again with a tighter threshold
    if embeddings.shape[0] == 0:
        return np.asarray([], dtype=int)

    if embeddings.shape[0] == 1:
        return np.asarray([0], dtype=int)

    top_labels = cluster_embeddings(embeddings, distance_threshold=top_threshold)
    final_labels = np.full(top_labels.shape[0], -1, dtype=int)
    next_label = 0

    for top_label in sorted(set(int(x) for x in top_labels.tolist())):
        top_indices = np.where(top_labels == top_label)[0]
        if top_indices.size == 0:
            continue

        use_subclusters = top_indices.size >= max(2 * min_cluster_size, min_cluster_size + 1)
        if use_subclusters: # only subdivide when the parent cluster is large enough to support meaningful subclusters, which translates to top_indices.size >= max(2 * min_cluster_size, min_cluster_size + 1)
            sub_embeddings = embeddings[top_indices]
            sub_labels = cluster_embeddings(sub_embeddings, distance_threshold=sub_threshold)
            sub_unique = sorted(set(int(x) for x in sub_labels.tolist()))

            assigned_any = False
            for sub_label in sub_unique:
                local_positions = np.where(sub_labels == sub_label)[0]
                if local_positions.size < min_cluster_size:
                    continue
                final_labels[top_indices[local_positions]] = next_label
                next_label += 1
                assigned_any = True

            if assigned_any:
                unassigned = top_indices[final_labels[top_indices] < 0]
                if unassigned.size > 0:
                    final_labels[unassigned] = next_label
                    next_label += 1
                continue

        final_labels[top_indices] = next_label
        next_label += 1

    if np.any(final_labels < 0):
        fill_label = int(final_labels[final_labels >= 0].max() + 1) if np.any(final_labels >= 0) else 0 # filling any unassigned nodes one by one so the output remains dense
        for i, value in enumerate(final_labels):
            if value < 0:
                final_labels[i] = fill_label
                fill_label += 1

    return final_labels

def edge_density_metrics(edge_index, labels): # measuring whether the clusters stay internally connected or leak across their given boundaries
    try:
        edge_np = edge_index.cpu().numpy()
    except Exception:
        edge_np = edge_index
    edges = set()
    for src, dst in edge_np.T:
        a, b = int(src), int(dst)
        if a == b:
            continue
        if a > b:
            a, b = b, a
        edges.add((a, b))

    node_to_cluster = {i: int(lbl) for i, lbl in enumerate(labels.tolist())}
    internal = 0
    cross = 0
    cluster_sizes = Counter(node_to_cluster.values())
    possible_internal = sum(size * (size - 1) / 2 for size in cluster_sizes.values())

    for a, b in edges:
        if node_to_cluster.get(a) == node_to_cluster.get(b):
            internal += 1
        else:
            cross += 1

    return {
        "within_cluster_edge_density": float(internal / possible_internal) if possible_internal > 0 else 0.0,
        "cross_cluster_edge_fraction": float(cross / len(edges)) if edges else 0.0,
    }

def extract_node_text(node): # giving the codebert baseline something textual to cluster from each node record
    name = (node.get("simpleName") or node.get("name") or "").strip()
    file = normalize_file_path(node.get("file") or node.get("repoRelativePath") or "")
    return f"{name} in {file}" if file else name

def compute_codebert_embeddings(texts, tokenizer, model): # doing the batching for the tokenizer/ model calls so the baseline stays doable on larger projects
    model.eval()
    batch_size = 16
    outputs: List[np.ndarray] = []
    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            enc = tokenizer(batch, padding=True, truncation=True, return_tensors="pt")
            enc = {k: v.to(DEVICE) for k, v in enc.items()}
            out = model(**enc, return_dict=True)
            if getattr(out, "pooler_output", None) is not None:
                pooled = out.pooler_output
            else:
                last = out.last_hidden_state
                mask = enc["attention_mask"].unsqueeze(-1).to(last.dtype)
                summed = (last * mask).sum(1)
                denom = mask.sum(1).clamp(min=1.0)
                pooled = summed / denom
            outputs.append(pooled.cpu().numpy())
    return np.vstack(outputs)


def graph_from_edge_index(edge_index): # !!!converting the adjacency representation into a networkx graph for node2vec walks
    try:
        edge_np = edge_index.cpu().numpy()
    except Exception:
        edge_np = edge_index
    graph = nx.Graph()
    for src, dst in edge_np.T:
        graph.add_edge(str(int(src)), str(int(dst)))
    return graph

def generate_random_walks(graph, num_walks = 10, walk_length = 40, seed = 13): # generating node2vec walks randomly
    rng = np.random.default_rng(seed)
    nodes = list(graph.nodes())
    walks: List[List[str]] = []
    for _ in range(num_walks):
        for node in nodes:
            walk = [node]
            current = node
            for _ in range(walk_length - 1):
                neighbors = list(graph.neighbors(current))
                if not neighbors:
                    break
                current = neighbors[int(rng.integers(0, len(neighbors)))]
                walk.append(current)
            walks.append(walk)
    return walks

def compute_node2vec_embeddings(graph): # training a lightweight skip gram model over random walks to create the node2vec baseline
    Word2Vec = importlib.import_module("gensim.models").Word2Vec
    walks = generate_random_walks(graph)
    model = Word2Vec(sentences=walks, vector_size=128, window=5, min_count=0, sg=1, workers=1, epochs=10)
    return {node: model.wv[str(node)] for node in graph.nodes()}

def paired_test(values_a, values_b): # used to compare paired project level scores with both parametric and nonparametric tests
    a = np.asarray(values_a, dtype=float)
    b = np.asarray(values_b, dtype=float)
    mask = np.isfinite(a) & np.isfinite(b)
    a = a[mask]
    b = b[mask]
    if a.size < 2:
        return {"n": int(a.size), "t_pvalue": None, "wilcoxon_pvalue": None}
    out: Dict[str, Any] = {"n": int(a.size)}
    try:
        out["t_stat"], out["t_pvalue"] = [float(x) for x in ttest_rel(a, b)]
    except Exception as exc:
        out["t_error"] = str(exc)
    try:
        stat, p = wilcoxon(a, b)
        out["wilcoxon_stat"] = float(stat)
        out["wilcoxon_pvalue"] = float(p)
    except Exception as exc:
        out["wilcoxon_error"] = str(exc)
    return out

def choose_best_method(row): # simple score so the script can name the strongest method per project
    candidates = []
    for method in ["dgi_finetuned", "dgi_unsupervised", "codebert", "node2vec"]:
        sil = row.get(f"{method}_silhouette")
        db = row.get(f"{method}_db")
        purity = row.get(f"{method}_purity")
        if sil is None or db is None or purity is None:
            continue
        score = float(sil) - float(db) + float(purity) # will favor compact/ pure clusters with strong separation
        candidates.append((method, score))
    if not candidates:
        return ("none", float("nan"))
    return max(candidates, key=lambda item: item[1])

def build_comparison_rows(projects, top_threshold, sub_threshold, min_cluster_size): # evaluating every project with every embedding source and keeping the full metric in a record
    rows = []
    codebert_tokenizer = AutoTokenizer.from_pretrained(CODEBERT_MODEL_ID)
    codebert_model = AutoModel.from_pretrained(CODEBERT_MODEL_ID).to(DEVICE)

    for project_dir in projects:
        print(f"[eval] {project_dir.name}")
        pkl_path = find_project_pickles(project_dir)[0]
        _, node_list, _ = load_graph_bundle(pkl_path)

        # finetuned dgi
        ft_encoder, ft_projection, ft_meta = load_encoder(pkl_path, prefer_finetuned=True)
        ft_embeddings, ft_nodes, ft_edge_index = compute_dgi_embeddings(pkl_path, ft_encoder, ft_projection)
        ft_labels = cluster_embeddings(ft_embeddings, distance_threshold=top_threshold)
        ft_metrics = cluster_metrics(ft_embeddings, ft_nodes, ft_labels, ft_edge_index)

        # unsupervised dgi (gets a fixed threshold pass and a sweep so collapsed clusters can recover)
        uns_encoder, uns_projection, uns_meta = load_encoder(pkl_path, prefer_finetuned=False)
        uns_embeddings, uns_nodes, uns_edge_index = compute_dgi_embeddings(pkl_path, uns_encoder, uns_projection)
        uns_labels = cluster_embeddings(uns_embeddings, distance_threshold=top_threshold)
        uns_fixed_metrics = cluster_metrics(uns_embeddings, uns_nodes, uns_labels, uns_edge_index)
        # sweep the unsupervised threshold range and keep the best valid candidate
        uns_sweep = []
        for top in DEFAULT_UNSUPERVISED_TOP_THRESHOLDS:
            try:
                sweep_labels = cluster_embeddings(uns_embeddings, distance_threshold=top)
                sweep_metrics = cluster_metrics(uns_embeddings, uns_nodes, sweep_labels, uns_edge_index)
                uns_sweep.append({
                    "top_threshold": top,
                    **sweep_metrics,
                })
            except Exception as exc:
                uns_sweep.append({"top_threshold": top, "error": str(exc)})

        uns_best_sweep = select_best_sweep_candidate(uns_sweep)
        uns_metrics = uns_best_sweep or uns_fixed_metrics

        # codebert acts as the text only baseline for the same project nodes
        codebert_metrics: Dict[str, Any] = {"error": "transformers unavailable"}
        if codebert_tokenizer is not None and codebert_model is not None:
            texts = [extract_node_text(node) for node in node_list]
            codebert_embeddings = compute_codebert_embeddings(texts, codebert_tokenizer, codebert_model)
            codebert_labels = cluster_embeddings(codebert_embeddings, distance_threshold=top_threshold)
            codebert_metrics = cluster_metrics(codebert_embeddings, node_list, codebert_labels, edge_index=None)

        # node2vec gives a topology only baseline built from random walks over the graph
        data, _, _ = load_graph_bundle(pkl_path)
        graph = graph_from_edge_index(data.edge_index)
        emb_dict = compute_node2vec_embeddings(graph)
        key_order = [str(i) for i in range(len(node_list)) if str(i) in emb_dict]
        node2vec_embeddings = np.vstack([emb_dict[k] for k in key_order]) if key_order else np.zeros((0, 128), dtype=np.float32)
        node2vec_labels = cluster_embeddings(node2vec_embeddings, distance_threshold=top_threshold) if node2vec_embeddings.size else np.asarray([], dtype=int)
        node2vec_metrics = cluster_metrics(node2vec_embeddings, node_list[: len(node2vec_labels)], node2vec_labels, edge_index=None) if node2vec_embeddings.size else {"error": "empty embeddings"}

        sweep = []
        for top in DEFAULT_TOP_THRESHOLDS if top_threshold is None else [top_threshold]:
            for sub in DEFAULT_SUB_THRESHOLDS if sub_threshold is None else [sub_threshold]:
                try:
                    labels = cluster_embeddings(ft_embeddings, distance_threshold=top)
                    metrics = cluster_metrics(ft_embeddings, ft_nodes, labels, ft_edge_index)
                    sweep.append({"top_threshold": top, "sub_threshold": sub, **metrics})
                except Exception as exc:
                    sweep.append({"top_threshold": top, "sub_threshold": sub, "error": str(exc)})

        best_sweep = None
        if sweep:
            best_sweep = select_best_sweep_candidate(sweep)

        best_method, best_score = choose_best_method({
            "dgi_finetuned_silhouette": ft_metrics.get("silhouette"),
            "dgi_finetuned_db": ft_metrics.get("davies_bouldin"),
            "dgi_finetuned_purity": ft_metrics.get("purity"),
            "dgi_unsupervised_silhouette": uns_metrics.get("silhouette"),
            "dgi_unsupervised_db": uns_metrics.get("davies_bouldin"),
            "dgi_unsupervised_purity": uns_metrics.get("purity"),
            "codebert_silhouette": codebert_metrics.get("silhouette"),
            "codebert_db": codebert_metrics.get("davies_bouldin"),
            "codebert_purity": codebert_metrics.get("purity"),
            "node2vec_silhouette": node2vec_metrics.get("silhouette"),
            "node2vec_db": node2vec_metrics.get("davies_bouldin"),
            "node2vec_purity": node2vec_metrics.get("purity"),
        })

        rows.append({
            "project": project_dir.name,
            "dgi_finetuned_silhouette": ft_metrics.get("silhouette"),
            "dgi_finetuned_db": ft_metrics.get("davies_bouldin"),
            "dgi_finetuned_purity": ft_metrics.get("purity"),
            "dgi_unsupervised_silhouette": uns_metrics.get("silhouette"),
            "dgi_unsupervised_db": uns_metrics.get("davies_bouldin"),
            "dgi_unsupervised_purity": uns_metrics.get("purity"),
            "codebert_silhouette": codebert_metrics.get("silhouette"),
            "codebert_db": codebert_metrics.get("davies_bouldin"),
            "codebert_purity": codebert_metrics.get("purity"),
            "node2vec_silhouette": node2vec_metrics.get("silhouette"),
            "node2vec_db": node2vec_metrics.get("davies_bouldin"),
            "node2vec_purity": node2vec_metrics.get("purity"),
            "best_method": best_method,
            "best_method_score": best_score,
            "dgi_top_threshold": top_threshold,
            "dgi_sub_threshold": sub_threshold,
            "dgi_sweep": sweep,
            "dgi_best_sweep": best_sweep,
            "dgi_unsupervised_fixed_silhouette": uns_fixed_metrics.get("silhouette"),
            "dgi_unsupervised_fixed_db": uns_fixed_metrics.get("davies_bouldin"),
            "dgi_unsupervised_fixed_purity": uns_fixed_metrics.get("purity"),
            "dgi_unsupervised_sweep": uns_sweep,
            "dgi_unsupervised_best_sweep": uns_best_sweep,
            "dgi_unsupervised_best_threshold": uns_best_sweep.get("top_threshold") if uns_best_sweep else None,
            "dgi_finetuned_encoder": ft_meta,
            "dgi_unsupervised_encoder": uns_meta,
        })

        analysis_dir = project_dir / DEFAULT_ANALYSIS_SUBDIR
        analysis_dir.mkdir(parents=True, exist_ok=True)
        dump_json(analysis_dir / "metrics-comparison.json", rows[-1])

    return rows


def summarise_rows(rows):
    df = pd.DataFrame(rows)
    summary = {"project_count": int(len(rows))}
    for metric in ["silhouette", "db", "purity"]:
        for method in ["dgi_finetuned", "dgi_unsupervised", "codebert", "node2vec"]:
            col = f"{method}_{metric}"
            values = pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(dtype=float)
            summary[col] = {
                "mean": float(values.mean()) if len(values.dropna()) else None,
                "median": float(values.median()) if len(values.dropna()) else None,
                "count": int(values.dropna().shape[0]),
            }

    summary["paired_tests"] = {
        "dgi_finetuned_vs_unsupervised_silhouette": paired_test(df["dgi_finetuned_silhouette"], df["dgi_unsupervised_silhouette"]),
        "dgi_finetuned_vs_node2vec_silhouette": paired_test(df["dgi_finetuned_silhouette"], df["node2vec_silhouette"]),
        "dgi_finetuned_vs_codebert_purity": paired_test(df["dgi_finetuned_purity"], df["codebert_purity"]),
        "dgi_finetuned_vs_unsupervised_db": paired_test(df["dgi_finetuned_db"], df["dgi_unsupervised_db"]),
        "dgi_finetuned_vs_node2vec_db": paired_test(df["dgi_finetuned_db"], df["node2vec_db"]),
    }

    summary["best_method_counts"] = df["best_method"].value_counts(dropna=False).to_dict()
    return summary


def format_metric_table(rows):
    df = pd.DataFrame(rows)
    if df.empty:
        return "No rows to summarize"

    method_specs = [
        ("dgi_unsupervised", "dgi nesupervizat"),
        ("dgi_finetuned", "dgi finetuned"),
        ("node2vec", "node2vec"),
        ("codebert", "codebert"),
    ]
    metric_specs = [
        ("silhouette", "silhouette"),
        ("db", "davies-bouldin"),
        ("purity", "puritate"),
    ]

    table_rows = []
    for method_key, method_label in method_specs:
        row = [method_label]
        for metric_key, _metric_label in metric_specs:
            col = f"{method_key}_{metric_key}"
            values = pd.to_numeric(df[col], errors="coerce") if col in df.columns else pd.Series(dtype=float)
            valid = values.dropna()
            if valid.empty:
                value = "necalculat"
            else:
                mean = valid.mean()
                std = valid.std(ddof=1) if len(valid) > 1 else 0.0
                value = f"{mean:.3f} ± {std:.3f}"
            row.append(value)
        table_rows.append(row)

    headers = ["metoda", *[metric_label for _, metric_label in metric_specs]]
    return tabulate(table_rows, headers=headers, tablefmt="github", stralign="right", numalign="right")

def make_plots(rows, out_dir):
    df = pd.DataFrame(rows)
    if df.empty:
        return

    df = df.copy()
    df = df.sort_values(
        by="project",
        key=lambda series: series.map(project_sort_key),
        ascending=True,
    ).reset_index(drop=True)

    method_specs = [
        ("dgi_finetuned", "DGI finetuned", "#0f766e"),
        ("dgi_unsupervised", "DGI unsupervised", "#2563eb"),
        ("codebert", "CodeBERT", "#7c3aed"),
        ("node2vec", "Node2Vec", "#dc2626"),
    ]
    metric_specs = [
        ("silhouette", "Silhouette", False),
        ("db", "Davies-Bouldin", True),
        ("purity", "Purity", False),
    ]

    numeric_cols = [
        "dgi_finetuned_silhouette", "dgi_unsupervised_silhouette", "codebert_silhouette", "node2vec_silhouette",
        "dgi_finetuned_db", "dgi_unsupervised_db", "codebert_db", "node2vec_db",
        "dgi_finetuned_purity", "dgi_unsupervised_purity", "codebert_purity", "node2vec_purity",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    fig, axes = plt.subplots(1, len(metric_specs), figsize=(22, 7), constrained_layout=True)
    if len(metric_specs) == 1:
        axes = [axes]

    for ax, (metric, title, invert_axis) in zip(axes, metric_specs): # plotting each method as a separate line across projects for the current metric
        x = np.arange(len(df["project"]))
        for method_key, label, color in method_specs:
            y = pd.to_numeric(df[f"{method_key}_{metric}"], errors="coerce") if f"{method_key}_{metric}" in df else pd.Series(dtype=float)
            if y.dropna().empty:
                continue
            ax.plot(x, y, label=label, color=color, linewidth=2.0, marker="o", markersize=4, alpha=0.9)

        style_project_xaxis(ax, df["project"].tolist())
        ax.set_title(title)
        ax.set_ylabel(title)
        ax.grid(True, axis="y", alpha=0.2)
        if invert_axis:
            ax.invert_yaxis()
        ax.legend(loc="best")

    fig.suptitle("Parallel comparison across projects", fontsize=14, fontweight="bold")
    fig.savefig(out_dir / "clustering_comparison.png", dpi=180)
    plt.close(fig)

projects = discover_projects()
if not projects:
    raise FileNotFoundError("No project directories with preprocessed graphs were found")

# keep only project folders that still have usable graph pickles
projects = [p for p in projects if p.exists() and find_project_pickles(p)]
if not projects:
    raise FileNotFoundError("No valid project directories with preprocessed graphs were found")

out_dir = BASE_DIR
rows = build_comparison_rows(projects, top_threshold=0.34, sub_threshold=0.22, min_cluster_size=DEFAULT_MIN_CLUSTER_SIZE)

# running the threshold sweep in order to regenerate docs only when the best sweep result is available
sweep_dir = out_dir / "dgi-threshold-sweeps"
sweep_dir.mkdir(parents=True, exist_ok=True)
sweep_payload = {}
for project_dir in projects:
    pkl_path = find_project_pickles(project_dir)[0]
    encoder, projection_head, encoder_meta = load_encoder(pkl_path, prefer_finetuned=True)
    embeddings, node_list, edge_index = compute_dgi_embeddings(pkl_path, encoder, projection_head)
    sweep_results = []
    for top in DEFAULT_TOP_THRESHOLDS:
        for sub in DEFAULT_SUB_THRESHOLDS:
            try:
                labels = build_hierarchical_labels(embeddings, top_threshold=top, sub_threshold=sub, min_cluster_size=DEFAULT_MIN_CLUSTER_SIZE)
                metrics = cluster_metrics(embeddings, node_list, labels, edge_index)
                sweep_results.append({
                    "projectId": project_dir.name,
                    "top_threshold": top,
                    "sub_threshold": sub,
                    "encoder": encoder_meta,
                    **metrics,
                })
            except Exception as exc:
                sweep_results.append({"top_threshold": top, "sub_threshold": sub, "error": str(exc)})
    valid = [item for item in sweep_results if "error" not in item]
    best = None
    if valid:
        best = select_best_sweep_candidate(valid)
        if best is not None:
            try:
                from generate_dgi_documentation import generate_for_project
                generate_for_project(
                    project_dir,
                    top_threshold=float(best["top_threshold"]),
                    sub_threshold=float(best["sub_threshold"]),
                    min_cluster_size=DEFAULT_MIN_CLUSTER_SIZE,
                )
            except Exception as exc:
                print(f"[sweep] doc regeneration skipped for {project_dir.name}: {exc}")
    sweep_payload[project_dir.name] = {"results": sweep_results, "best": best}
    dump_json(sweep_dir / f"{project_dir.name}.json", sweep_payload[project_dir.name])

dump_json(out_dir / "dgi-threshold-sweeps.json", sweep_payload)

summary = summarise_rows(rows)
dump_json(out_dir / "clustering-eval-summary.json", summary)

df = pd.DataFrame(rows)
df.to_csv(out_dir / "clustering-eval-summary.csv", index=False)
make_plots(rows, out_dir)

print(f"Evaluated {len(rows)} project(s).")
print(format_metric_table(rows))
print(f"Summary json: {out_dir / 'clustering-eval-summary.json'}")
print(f"Summary csv: {out_dir / 'clustering-eval-summary.csv'}")
print(f"Plot: {out_dir / 'clustering_comparison.png'}")