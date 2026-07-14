from pathlib import Path
import json
import numpy as np
import torch
import matplotlib.pyplot as plt
from transformers import AutoTokenizer, AutoModel
import os
from sklearn.metrics.pairwise import cosine_similarity
from collections import defaultdict, deque
from tabulate import tabulate
from train_unsupervised_dgi import load_graph_bundle, MultiGraphEncoder
from train_query_projection import QueryProjection
from inference_raw_ppr import get_seed_one_hop_cluster, retrieve_raw_seed_ppr_cluster
from eval_plot_utils import sort_rows_by_project, style_project_xaxis, project_ids_from_rows
import argparse

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"

parser = argparse.ArgumentParser()
parser.add_argument('--split', choices=['val', 'test'], default='test', help='split to evaluate (val or test)')
args = parser.parse_args()

if args.split == 'val':
    QUERIES_JSON = "nl_queries_inductive_val.json"
else:
    QUERIES_JSON = "nl_queries_inductive_test.json"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

METHODS = [
    "raw_knn",
    "proj_knn",
    "dgi_direct",
    "raw_seed_dgi_knn",
    "raw_seed_ppr",
    "dgi_seed_ppr",
    "dgi_knn_rerank",
    "dgi_rerank_raw_knn",
]

METHOD_COLORS = [
    "#0f766e",
    "#2563eb",
    "#7c3aed",
    "#dc2626",
    "#f59e0b",
    "#14b8a6",
    "#8b5cf6",
    "#ef4444",
]

def make_per_project_plot(rows, out_dir, split):
    rows = sort_rows_by_project(rows)
    if not rows:
        return None

    metric_specs = [
        ("f1", "F1", False),
        ("recall", "Recall", False),
        ("precision", "Precision", False),
    ]

    x = np.arange(len(rows))
    projects = project_ids_from_rows(rows)

    fig, axes = plt.subplots(1, len(metric_specs), figsize=(24, 8), constrained_layout=True)
    if len(metric_specs) == 1:
        axes = [axes]

    for ax, (metric_key, title, invert_axis) in zip(axes, metric_specs):
        for method_key, color in zip(METHODS, METHOD_COLORS):
            y = np.asarray([row[f"{method_key}_{metric_key}"] for row in rows], dtype=float)
            if np.all(np.isnan(y)):
                continue
            ax.plot(
                x,
                y,
                label=method_key,
                color=color,
                linewidth=1.8,
                marker="o",
                markersize=3.5,
                alpha=0.9,
            )

        style_project_xaxis(ax, projects)
        ax.set_ylim(0, 1)
        ax.set_title(title)
        ax.set_ylabel(title)
        ax.grid(True, axis="y", alpha=0.2)
        if invert_axis:
            ax.invert_yaxis()
        ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=4, fontsize=8)

    fig.suptitle(f"Query retrieval per project ({split} split)", fontsize=14, fontweight="bold")
    plot_file = out_dir / f"retrieval_evaluation_inductive_{split}_per_project.png"
    fig.savefig(plot_file, dpi=180, bbox_inches="tight")
    plt.close(fig)
    return plot_file

def embed_query_unixcoder(text, tokenizer, model, max_len=512): # embedding a single natural language query using the shared UniXcoder model
    # use the shared query encoder so every retrieval method starts from the same text representation
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=max_len).to(DEVICE)
    with torch.no_grad():
        outputs = model(**inputs)
    mask = inputs["attention_mask"].unsqueeze(-1).to(outputs.last_hidden_state.dtype)
    emb = (outputs.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)
    return emb.squeeze().cpu().numpy().astype(np.float32)

def get_true_cluster(target_idx, edge_index):  # ground truth target node + its 1 hop neighbours
    # the evaluation target is the node itself plus its immediate neighbors in the graph
    edge_np = edge_index.cpu().numpy()
    true = {target_idx}
    for src, dst in edge_np.T:
        if src == target_idx:
            true.add(int(dst))
        if dst == target_idx:
            true.add(int(src))
    return true

def get_connected_component_set(node_idx, edge_index):  # set of all node indices in the same connected component as node_idx
    # connectivity filtering keeps every retrieval result inside the seed's graph component
    edge_np = edge_index.cpu().numpy()
    adj = defaultdict(set)
    for src, dst in edge_np.T:
        adj[int(src)].add(int(dst))
        adj[int(dst)].add(int(src))
    visited = set()
    queue = deque([node_idx])
    while queue:
        u = queue.popleft()
        if u in visited:
            continue
        visited.add(u)
        for v in adj[u]:
            if v not in visited:
                queue.append(v)
    return visited

def shared_neighbour_budget(q_emb_proj, raw_emb, edge_index): # sizing rule from RAW_SEED_PPR: count = projected query seed's graph 1 hop
    seed_idx = int(np.argmax(cosine_similarity([q_emb_proj], raw_emb)[0]))
    component = get_connected_component_set(seed_idx, edge_index)
    local = get_seed_one_hop_cluster(seed_idx, edge_index) & component
    if not local:
        local = {seed_idx}
    return seed_idx, len(local), local

def retrieve_top_k_from_scores(scores, k, always_include=None): # top k finite scores
    scores = np.asarray(scores)
    k = max(1, int(k))
    order = np.argsort(-scores, kind="mergesort")
    selected: list[int] = []
    for idx in order:
        if not np.isfinite(scores[int(idx)]):
            continue
        selected.append(int(idx))
        if len(selected) >= k:
            break
    result = set(selected)
    if always_include is not None:
        result.add(int(always_include))
    return result, len(result)

def embed_query_with_projection(text): # trying to project the query into the same space used by the dgi based retrieval methods
    with torch.no_grad():
        emb = projection_model([text]).squeeze().cpu().numpy()
    return emb.astype(np.float32)

def retrieve_dgi_seeded_diffusion(q_emb_proj, dgi_emb, edge_index, num_seeds=1, alpha=0.85, iterations=30): # personalized PageRank diffusion seeded directly from dgi space query similarity
    # this removes the raw embedding seed lookup so the encoder itself has to provide the seed

    # this variant is stricter because dgi similarity alone determines the initial seed set
    N = dgi_emb.shape[0]

    sim_dgi = cosine_similarity([q_emb_proj], dgi_emb)[0]
    seed_indices = np.argsort(-sim_dgi)[:num_seeds]

    edges = edge_index.cpu().numpy()
    adj = defaultdict(list)
    for src, dst in edges.T:
        adj[int(src)].append(int(dst))
        adj[int(dst)].append(int(src))

    deg = np.array([len(adj[i]) for i in range(N)])

    r = np.zeros(N)
    r[seed_indices] = 1.0 / len(seed_indices)
    r0 = r.copy()

    for _ in range(iterations):
        # the diffusion step is identical to the raw seed version once the initial seed vector is fixed
        r_new = (1 - alpha) * r0
        r_contrib = np.zeros(N)
        for i in range(N):
            if deg[i] > 0 and r[i] != 0:
                contrib = r[i] / deg[i]
                for j in adj[i]:
                    r_contrib[j] += contrib
        r_new += alpha * r_contrib
        r = r_new

    return r, seed_indices[0]

def rank_within_retrieved_set(scores, retrieved, target_idx): # ranking the target only among the nodes returned by a retrieval method
    # ranking metrics are computed only on the retrieved set so the score reflects the method's actual output
    retrieved = [int(i) for i in retrieved if np.isfinite(scores[int(i)])]
    if not retrieved or int(target_idx) not in retrieved:
        return 0, 0.0, 0, 0, 0

    retrieved_scores = np.asarray([scores[int(i)] for i in retrieved])
    target_score = scores[int(target_idx)]
    rank = 1 + int(np.sum(retrieved_scores > target_score))
    mrr = 1.0 / rank if rank > 0 else 0.0
    hits1 = 1 if rank == 1 else 0
    hits5 = 1 if rank <= 5 else 0
    hits10 = 1 if rank <= 10 else 0
    return rank, mrr, hits1, hits5, hits10

print(f"Evaluating on {args.split.upper()} set with DGI finetuned encoder")
print(f"Loading queries from: {QUERIES_JSON}")
print("Neighbour count: unified RAW_SEED_PPR budget (projected-query seed graph 1 hop size) for every method and the methods differ only in which nodes they pick within that budget")

print(f"Base directory: {BASE_DIR}")

# the retrieval scripts run against every available project pickle in the workspace
pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl"))
if not pkl_files:
    print("No preprocessed graph pickles found, run preprocess_graphs.py first")
    exit()

FINETUNED_ENCODER_PATH = BASE_DIR / "finetuned_inductive_dgi_encoder.pt"
PROJECTION_HEAD_PATH = BASE_DIR / "node_projection_head.pt"
from train_finetuned_dgi import ProjectionHead # for dgi's projection head

if not FINETUNED_ENCODER_PATH.exists():
    raise FileNotFoundError(f"Finetuned encoder not found at {FINETUNED_ENCODER_PATH}")

sample_pkl = pkl_files[0]
sample_data, _, _ = load_graph_bundle(sample_pkl)
in_channels = sample_data.num_features

ckpt = torch.load(FINETUNED_ENCODER_PATH, map_location=DEVICE)

# dgi: hidden and out channels from the first and last layer weights
hidden_channels = ckpt['mp1.lin.weight'].shape[0]
out_channels = ckpt['mp3.lin.weight'].shape[0]
encoder = MultiGraphEncoder(in_channels, hidden_channels, out_channels, use_input_proj=True).to(DEVICE)

encoder.load_state_dict(ckpt)
encoder.eval()
print(f"Loaded DGI finetuned encoder (hidden={hidden_channels}, out={out_channels})")

# Load projection head using the path already set (do NOT redefine)
if PROJECTION_HEAD_PATH.exists():
    # if the finetuned run saved a node projection head, reuse it for the DGI feature space
    projection_head_state = torch.load(PROJECTION_HEAD_PATH, map_location=DEVICE)
    projection_hidden_dim = projection_head_state["net.0.weight"].shape[0]
    node_projection_head = ProjectionHead(out_channels, projection_hidden_dim, out_channels).to(DEVICE)
    node_projection_head.load_state_dict(projection_head_state)
    node_projection_head.eval()
    print(f"Loaded projection head from {PROJECTION_HEAD_PATH}")
else:
    node_projection_head = None
    print(f"No projection head found at {PROJECTION_HEAD_PATH}, using raw embeddings")

PROJECTION_PATH = BASE_DIR / "seed_projection.pt"
if not PROJECTION_PATH.exists():
    raise FileNotFoundError(f"Projection model not found at {PROJECTION_PATH}, run train_query_projection.py first")
# the projection must output same dimension as dgi encoder output (out_channels)
projection_model = QueryProjection(proj_dim=out_channels, freeze_encoder=True).to(DEVICE)
projection_model.proj.load_state_dict(torch.load(PROJECTION_PATH, map_location=DEVICE))
projection_model.eval()
print(f"Loaded projection model (output dim={out_channels})")

print("\nLoading UniXcoder for query embedding...")
unix_tokenizer = AutoTokenizer.from_pretrained("microsoft/unixcoder-base")
unix_model = AutoModel.from_pretrained("microsoft/unixcoder-base").to(DEVICE)
unix_model.eval()

def empty_retrieval_metrics():
    return {"f1": [], "recall": [], "precision": [], "size": []}

def empty_rank_metrics():
    return {"mrr": [], "hits1": [], "hits5": [], "hits10": []}

results = {method: empty_retrieval_metrics() for method in METHODS}
rank_results = {method: empty_rank_metrics() for method in METHODS}
semantic = {method: [] for method in METHODS}

per_query_log = []
per_project_rows = []
per_project_results = {
    method: {"f1": [], "recall": [], "precision": []}
    for method in METHODS
}

for pkl_path in pkl_files:
    # each project contributes its own query set so the evaluation stays project local
    project_dir = pkl_path.parent
    project_id = project_dir.name
    for method in METHODS:
        per_project_results[method] = {"f1": [], "recall": [], "precision": []}
    queries_path = project_dir / QUERIES_JSON
    print(f"\nProcessing project: {project_id}")
    if not queries_path.exists():
        print(f"Error: {QUERIES_JSON} not found, run generate_queries.py first")
        continue
    with open(queries_path, "r", encoding="utf-8") as f:
        queries = json.load(f)
    print(f"\tLoaded {len(queries)} queries")

    data, node_list, _ = load_graph_bundle(pkl_path)
    raw_emb = data.x.cpu().numpy()
    edge_index = data.edge_index

    with torch.no_grad():
        dgi_emb_raw = encoder(data.x.to(DEVICE), edge_index.to(DEVICE))
        if node_projection_head is not None:
            # if the finetuned run learned a projection head, compare against that feature space too
            dgi_emb = node_projection_head(dgi_emb_raw).cpu().numpy()
        else:
            dgi_emb = dgi_emb_raw.cpu().numpy()

    id_to_idx = {node["id"]: i for i, node in enumerate(node_list)}

    for q_text, target_node_id in queries.items():
        if target_node_id not in id_to_idx:
            continue # skipping queries whose targets were removed by preprocessing or never mapped into the node list
        target_idx = id_to_idx[target_node_id]
        true_cluster = get_true_cluster(target_idx, edge_index)
        degree = len(true_cluster) - 1
        if degree == 0:
            continue # isolated targets are not useful for neighborhood retrieval metrics, so they are skipped
        target_name = node_list[target_idx].get('simpleName') or node_list[target_idx].get('name') or f"node_{target_idx}"

        q_raw = embed_query_unixcoder(q_text, unix_tokenizer, unix_model)
        q_emb_proj = embed_query_with_projection(q_text)

        size_seed_idx, neighbour_k, _size_seed_local = shared_neighbour_budget(q_emb_proj, raw_emb, edge_index)

        raw_sim = cosine_similarity([q_raw], raw_emb)[0]
        raw_retrieved, _ = retrieve_top_k_from_scores(raw_sim, neighbour_k)

        raw_sim_all = cosine_similarity([q_raw], raw_emb)[0]
        raw_pool_indices = np.argsort(-raw_sim_all, kind="mergesort")[: min(100, raw_sim_all.shape[0])]
        dgi_pool_scores = np.asarray([
            cosine_similarity([q_emb_proj], [dgi_emb[int(node)]])[0][0]
            for node in raw_pool_indices
        ])
        pool_order = np.argsort(-dgi_pool_scores, kind="mergesort")[:neighbour_k]
        dgi_reranked_retrieved = {int(raw_pool_indices[pos]) for pos in pool_order}

        proj_sim = cosine_similarity([q_emb_proj], raw_emb)[0]
        proj_retrieved, _ = retrieve_top_k_from_scores(proj_sim, neighbour_k)

        dgi_dir_sim = cosine_similarity([q_emb_proj], dgi_emb)[0]
        dgi_direct_retrieved, _ = retrieve_top_k_from_scores(dgi_dir_sim, neighbour_k)

        seed_idx = size_seed_idx
        sim_dgi_from_seed = cosine_similarity([dgi_emb[seed_idx]], dgi_emb)[0]
        raw_seed_dgi_knn_retrieved, _ = retrieve_top_k_from_scores(sim_dgi_from_seed, neighbour_k, always_include=seed_idx)
        raw_seed_dgi_knn_retrieved &= get_connected_component_set(seed_idx, edge_index)

        raw_seed_ppr_retrieved, _, _, diffusion_scores_raw = retrieve_raw_seed_ppr_cluster(q_emb_proj, raw_emb, edge_index, max_scan=50, min_k=1, alpha=0.85, iterations=30)

        diffusion_scores_dgi_seed, best_seed_dgi_seed = retrieve_dgi_seeded_diffusion(q_emb_proj, dgi_emb, edge_index, num_seeds=1, alpha=0.85, iterations=30)
        dgi_seed_ppr_retrieved, _ = retrieve_top_k_from_scores(diffusion_scores_dgi_seed, neighbour_k, always_include=best_seed_dgi_seed)
        dgi_seed_ppr_retrieved &= get_connected_component_set(best_seed_dgi_seed, edge_index)

        dgi_knn_sim = cosine_similarity([q_emb_proj], dgi_emb)[0]
        dgi_knn_rerank_retrieved, _ = retrieve_top_k_from_scores(dgi_knn_sim, neighbour_k)

        def metrics(retrieved, true): # computing precision/ recall/ f1 against the 1 hop target cluster for each retrieval method
            inter = len(retrieved & true)
            rec = inter / len(true) if true else 0.0
            prec = inter / len(retrieved) if retrieved else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
            return rec, prec, f1

        raw_rec, raw_prec, raw_f1 = metrics(raw_retrieved, true_cluster)
        dgi_rerank_raw_knn_rec, dgi_rerank_raw_knn_prec, dgi_rerank_raw_knn_f1 = metrics(dgi_reranked_retrieved, true_cluster)
        proj_rec, proj_prec, proj_f1 = metrics(proj_retrieved, true_cluster)
        dgi_dir_rec, dgi_dir_prec, dgi_dir_f1 = metrics(dgi_direct_retrieved, true_cluster)
        raw_seed_dgi_knn_rec, raw_seed_dgi_knn_prec, raw_seed_dgi_knn_f1 = metrics(raw_seed_dgi_knn_retrieved, true_cluster)
        raw_seed_ppr_rec, raw_seed_ppr_prec, raw_seed_ppr_f1 = metrics(raw_seed_ppr_retrieved, true_cluster)
        dgi_seed_ppr_rec, dgi_seed_ppr_prec, dgi_seed_ppr_f1 = metrics(dgi_seed_ppr_retrieved, true_cluster)
        dgi_knn_rerank_rec, dgi_knn_rerank_prec, dgi_knn_rerank_f1 = metrics(dgi_knn_rerank_retrieved, true_cluster)

        method_metrics = {
            "raw_knn": (raw_rec, raw_prec, raw_f1, len(raw_retrieved)),
            "proj_knn": (proj_rec, proj_prec, proj_f1, len(proj_retrieved)),
            "dgi_direct": (dgi_dir_rec, dgi_dir_prec, dgi_dir_f1, len(dgi_direct_retrieved)),
            "raw_seed_dgi_knn": (raw_seed_dgi_knn_rec, raw_seed_dgi_knn_prec, raw_seed_dgi_knn_f1, len(raw_seed_dgi_knn_retrieved)),
            "raw_seed_ppr": (raw_seed_ppr_rec, raw_seed_ppr_prec, raw_seed_ppr_f1, len(raw_seed_ppr_retrieved)),
            "dgi_seed_ppr": (dgi_seed_ppr_rec, dgi_seed_ppr_prec, dgi_seed_ppr_f1, len(dgi_seed_ppr_retrieved)),
            "dgi_knn_rerank": (dgi_knn_rerank_rec, dgi_knn_rerank_prec, dgi_knn_rerank_f1, len(dgi_knn_rerank_retrieved)),
            "dgi_rerank_raw_knn": (dgi_rerank_raw_knn_rec, dgi_rerank_raw_knn_prec, dgi_rerank_raw_knn_f1, len(dgi_reranked_retrieved)),
        }
        for method_key, (rec, prec, f1, size) in method_metrics.items():
            results[method_key]["f1"].append(f1)
            results[method_key]["recall"].append(rec)
            results[method_key]["precision"].append(prec)
            results[method_key]["size"].append(size)
            per_project_results[method_key]["f1"].append(f1)
            per_project_results[method_key]["recall"].append(rec)
            per_project_results[method_key]["precision"].append(prec)

        sim_dgi_dir_all = cosine_similarity([q_emb_proj], dgi_emb)[0]
        sim_dgi_rerank_raw = cosine_similarity([q_emb_proj], dgi_emb)[0]
        raw_seed_dgi_knn_scores = cosine_similarity([dgi_emb[seed_idx]], dgi_emb)[0]
        dgi_knn_scores = cosine_similarity([q_emb_proj], dgi_emb)[0]

        # ranking metrics are computed within each method's returned retrieval set
        # dgi_rerank_raw_knn: top-k from a raw UniXcoder pool, reranked by DGI similarity
        # dgi_knn_rerank: top-k chosen directly from full-graph DGI similarity
        rank_specs = [(method, *{
            "raw_knn": (raw_sim, raw_retrieved),
            "proj_knn": (proj_sim, proj_retrieved),
            "dgi_direct": (sim_dgi_dir_all, dgi_direct_retrieved),
            "raw_seed_dgi_knn": (raw_seed_dgi_knn_scores, raw_seed_dgi_knn_retrieved),
            "raw_seed_ppr": (diffusion_scores_raw, raw_seed_ppr_retrieved),
            "dgi_seed_ppr": (diffusion_scores_dgi_seed, dgi_seed_ppr_retrieved),
            "dgi_knn_rerank": (dgi_knn_scores, dgi_knn_rerank_retrieved),
            "dgi_rerank_raw_knn": (sim_dgi_rerank_raw, dgi_reranked_retrieved),
        }[method]) for method in METHODS]
        query_ranking = {}
        for method_key, scores, retrieved in rank_specs:
            _, mrr, hits1, hits5, hits10 = rank_within_retrieved_set(scores, retrieved, target_idx)
            rank_results[method_key]["mrr"].append(mrr)
            rank_results[method_key]["hits1"].append(hits1)
            rank_results[method_key]["hits5"].append(hits5)
            rank_results[method_key]["hits10"].append(hits10)
            query_ranking[method_key] = {
                "mrr": float(mrr),
                "hits1": int(hits1),
                "hits5": int(hits5),
                "hits10": int(hits10),
            }

        # semantic scores
        # the semantic relevance checks whether the retrieved set still stays close to the query text embedding
        if len(raw_retrieved) > 0:
            raw_sims = cosine_similarity([q_raw], raw_emb)[0][list(raw_retrieved)]
            raw_sem = np.mean(raw_sims)
        else:
            raw_sem = 0.0
        semantic["raw_knn"].append(raw_sem)

        if len(dgi_reranked_retrieved) > 0:
            rerank_sims = cosine_similarity([q_raw], raw_emb)[0][list(dgi_reranked_retrieved)]
            rerank_sem = np.mean(rerank_sims)
        else:
            rerank_sem = 0.0
        semantic["dgi_rerank_raw_knn"].append(rerank_sem)

        if len(proj_retrieved) > 0:
            proj_sims = cosine_similarity([q_raw], raw_emb)[0][list(proj_retrieved)]
            proj_sem = np.mean(proj_sims)
        else:
            proj_sem = 0.0
        semantic["proj_knn"].append(proj_sem)

        if len(dgi_direct_retrieved) > 0:
            dir_sims = cosine_similarity([q_raw], raw_emb)[0][list(dgi_direct_retrieved)]
            dir_sem = np.mean(dir_sims)
        else:
            dir_sem = 0.0
        semantic["dgi_direct"].append(dir_sem)

        if len(raw_seed_dgi_knn_retrieved) > 0:
            rsd_sims = cosine_similarity([q_raw], raw_emb)[0][list(raw_seed_dgi_knn_retrieved)]
            rsd_sem = np.mean(rsd_sims)
        else:
            rsd_sem = 0.0
        semantic["raw_seed_dgi_knn"].append(rsd_sem)

        if len(raw_seed_ppr_retrieved) > 0:
            rsp_sims = cosine_similarity([q_raw], raw_emb)[0][list(raw_seed_ppr_retrieved)]
            rsp_sem = np.mean(rsp_sims)
        else:
            rsp_sem = 0.0
        semantic["raw_seed_ppr"].append(rsp_sem)

        if len(dgi_seed_ppr_retrieved) > 0:
            dgi_seed_ppr_sims = cosine_similarity([q_raw], raw_emb)[0][list(dgi_seed_ppr_retrieved)]
            dgi_seed_ppr_sem = np.mean(dgi_seed_ppr_sims)
        else:
            dgi_seed_ppr_sem = 0.0
        semantic["dgi_seed_ppr"].append(dgi_seed_ppr_sem)

        if len(dgi_knn_rerank_retrieved) > 0:
            dgi_knn_rerank_sims = cosine_similarity([q_raw], raw_emb)[0][list(dgi_knn_rerank_retrieved)]
            dgi_knn_rerank_sem = np.mean(dgi_knn_rerank_sims)
        else:
            dgi_knn_rerank_sem = 0.0
        semantic["dgi_knn_rerank"].append(dgi_knn_rerank_sem)

        log_entry = {
            "project": str(project_id),
            "query": str(q_text),
            "target_node": str(target_name),
            "true_cluster_size": int(len(true_cluster)),
            "raw_knn": {"recall": float(raw_rec), "precision": float(raw_prec), "f1": float(raw_f1), "size": int(len(raw_retrieved))},
            "dgi_rerank_raw_knn": {"recall": float(dgi_rerank_raw_knn_rec), "precision": float(dgi_rerank_raw_knn_prec), "f1": float(dgi_rerank_raw_knn_f1), "size": int(len(dgi_reranked_retrieved))},
            "proj_knn": {"recall": float(proj_rec), "precision": float(proj_prec), "f1": float(proj_f1), "size": int(len(proj_retrieved))},
            "dgi_direct": {"recall": float(dgi_dir_rec), "precision": float(dgi_dir_prec), "f1": float(dgi_dir_f1), "size": int(len(dgi_direct_retrieved))},
            "raw_seed_dgi_knn": {"recall": float(raw_seed_dgi_knn_rec), "precision": float(raw_seed_dgi_knn_prec), "f1": float(raw_seed_dgi_knn_f1), "size": int(len(raw_seed_dgi_knn_retrieved))},
            "raw_seed_ppr": {"recall": float(raw_seed_ppr_rec), "precision": float(raw_seed_ppr_prec), "f1": float(raw_seed_ppr_f1), "size": int(len(raw_seed_ppr_retrieved))},
            "dgi_seed_ppr": {"recall": float(dgi_seed_ppr_rec), "precision": float(dgi_seed_ppr_prec), "f1": float(dgi_seed_ppr_f1), "size": int(len(dgi_seed_ppr_retrieved))},
            "dgi_knn_rerank": {"recall": float(dgi_knn_rerank_rec), "precision": float(dgi_knn_rerank_prec), "f1": float(dgi_knn_rerank_f1), "size": int(len(dgi_knn_rerank_retrieved))},
            "ranking": query_ranking,
            "semantic": {
                "raw_knn": float(raw_sem),
                "dgi_rerank_raw_knn": float(rerank_sem),
                "proj_knn": float(proj_sem),
                "dgi_direct": float(dir_sem),
                "raw_seed_dgi_knn": float(rsd_sem),
                "raw_seed_ppr": float(rsp_sem),
                "dgi_seed_ppr": float(dgi_seed_ppr_sem),
                "dgi_knn_rerank": float(dgi_knn_rerank_sem),
            }
        }
        per_query_log.append(log_entry)

    if any(per_project_results[method]["f1"] for method in METHODS):
        project_row = {"project_id": project_id}
        for method in METHODS:
            for metric_key in ("f1", "recall", "precision"):
                values = per_project_results[method][metric_key]
                project_row[f"{method}_{metric_key}"] = float(np.mean(values)) if values else np.nan
        per_project_rows.append(project_row)

print()
print("Retrieval metrics (1 hop neighbours):")
table = []
for method in METHODS:
    row = [
        method,
        f"{np.mean(results[method]['f1']):.3f}+/-{np.std(results[method]['f1']):.3f}",
        f"{np.mean(results[method]['recall']):.3f}+/-{np.std(results[method]['recall']):.3f}",
        f"{np.mean(results[method]['precision']):.3f}+/-{np.std(results[method]['precision']):.3f}",
    ]
    table.append(row)
print(tabulate(table, headers=["method", "f1", "recall", "precision"], tablefmt="grid"))

rank_rows = []
for method in METHODS:
    rank_dict = rank_results[method]
    rank_rows.append([
        method,
        f"{np.mean(rank_dict['mrr']):.3f}+/-{np.std(rank_dict['mrr']):.3f}",
        f"{np.mean(rank_dict['hits1']):.3f}",
        f"{np.mean(rank_dict['hits5']):.3f}",
        f"{np.mean(rank_dict['hits10']):.3f}",
    ])
print("\nRanking metrics (MRR and Hits@k):")
print(tabulate(rank_rows, headers=["method", "mrr", "hits@1", "hits@5", "hits@10"], tablefmt="grid"))

sem_rows = []
for method in METHODS:
    arr = semantic[method]
    sem_rows.append([
        method,
        f"{np.mean(arr):.3f}+/-{np.std(arr):.3f}",
    ])
print("\nSemantic relevance (cosine similarity to query using raw UniXcoder):")
print(tabulate(sem_rows, headers=["method", "mean+/-std"], tablefmt="grid"))

metric_specs = [
    ("f1", "F1", False),
    ("recall", "Recall", False),
    ("precision", "Precision", False),
]

fig, axes = plt.subplots(1, len(metric_specs), figsize=(18, 6), constrained_layout=True)
if len(metric_specs) == 1:
    axes = [axes]

method_indices = np.arange(len(METHODS))
method_names = list(METHODS)

for ax, (metric_key, title, invert_axis) in zip(axes, metric_specs):
    values = [float(np.mean(results[method][metric_key])) if results[method][metric_key] else 0.0 for method in METHODS]
    ax.bar(method_indices, values, color=METHOD_COLORS[:len(METHODS)])
    ax.set_xticks(method_indices)
    ax.set_xticklabels(method_names, rotation=35, ha="right")
    ax.set_ylim(0, 1)
    ax.set_title(title)
    ax.set_ylabel(title)
    ax.grid(True, axis="y", alpha=0.2)
    if invert_axis:
        ax.invert_yaxis()

fig.suptitle("Retrieval summary across methods", fontsize=14, fontweight="bold")
plot_file = BASE_DIR / f"retrieval_evaluation_inductive_{args.split}.png"
plt.savefig(plot_file, dpi=180)
plt.close(fig)
print(f"\nSaved retrieval plot to {plot_file}")

per_project_plot_file = make_per_project_plot(per_project_rows, BASE_DIR, args.split)
if per_project_plot_file is not None:
    print(f"Saved per-project retrieval plot to {per_project_plot_file}")

output_file = BASE_DIR / f"retrieval_evaluation_inductive_{args.split}.json"
with open(output_file, "w", encoding="utf-8") as f:
    json.dump(per_query_log, f, indent=2, ensure_ascii=False)
print(f"\nDetailed results saved to {output_file}")