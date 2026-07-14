# this script is used to generate a documentation map from dgi embeddings (hierarchical clusters for modules/ features, representative nodes per cluster, optional commit evolution sections when commit history exists)
from __future__ import annotations
import argparse
import json
import os
import sys
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
import numpy as np
import torch
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_similarity
from graph_embeddings import (BASE_DIR, ensure_preprocessed_graph, find_project_pickles, project_has_graph_source, resolve_shared_model_path)
from train_unsupervised_dgi import MultiGraphEncoder, load_graph_bundle

def resolve_project_dir(project_id, user_id = None):
    owner = (user_id or os.environ.get("PROJECT_OWNER_USER_ID", "")).strip()
    if owner:
        return BASE_DIR / owner / project_id
    return BASE_DIR / project_id

DEFAULT_ANALYSIS_SUBDIR = "analysis"

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

def normalize_file_path(value):
    if not value:
        return ""
    return value.replace("\\", "/").strip().lstrip("/")

def safe_mean(values):
    if not values:
        return 0.0
    return float(sum(values) / len(values))

def l2_normalize(matrix):
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms

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

def load_json_file(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)

def dump_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)

def discover_projects(project_filter = None, user_id = None):
    if project_filter:
        candidate = resolve_project_dir(project_filter, user_id)
        if candidate.exists() and candidate.is_dir():
            return [candidate]
        return []

    projects = []
    search_roots = [BASE_DIR]
    owner = (user_id or os.environ.get("PROJECT_OWNER_USER_ID", "")).strip()
    if owner:
        search_roots = [BASE_DIR / owner]

    for root in search_roots:
        if not root.exists():
            continue
        for project_dir in sorted(root.glob("*")):
            if not project_dir.is_dir():
                continue
            if project_has_graph_source(project_dir):
                projects.append(project_dir)
    return projects

def load_encoder(sample_pkl):
    sample_data, _, _ = load_graph_bundle(sample_pkl)
    in_channels = int(sample_data.num_features)

    finetuned_path = resolve_shared_model_path("finetuned_inductive_dgi_encoder.pt")
    unsupervised_path = resolve_shared_model_path("unsupervised_inductive_dgi_encoder.pt")
    if finetuned_path.exists():
        ckpt = torch.load(finetuned_path, map_location=DEVICE)
        source_path = finetuned_path
    elif unsupervised_path.exists():
        ckpt = torch.load(unsupervised_path, map_location=DEVICE)
        source_path = unsupervised_path
    else:
        raise FileNotFoundError(f"No DGI encoder found at {finetuned_path} or {unsupervised_path}")

    hidden_channels = int(ckpt["mp1.lin.weight"].shape[0])
    out_channels = int(ckpt["mp3.lin.weight"].shape[0])
    use_batch_norm = any(".bn." in key for key in ckpt.keys())
    encoder = MultiGraphEncoder(in_channels, hidden_channels, out_channels, use_input_proj=True, use_batch_norm=use_batch_norm).to(DEVICE)
    encoder.load_state_dict(ckpt)
    encoder.eval()

    projection_head = None
    projection_head_path = resolve_shared_model_path("node_projection_head.pt")
    if projection_head_path.exists():
        from train_finetuned_dgi import ProjectionHead

        projection_state = torch.load(projection_head_path, map_location=DEVICE)
        projection_hidden_dim = int(projection_state["net.0.weight"].shape[0])
        projection_head = ProjectionHead(out_channels, projection_hidden_dim, out_channels).to(DEVICE)
        projection_head.load_state_dict(projection_state)
        projection_head.eval()

    print(f"Loaded DGI encoder from {source_path.name} (in={in_channels}, hidden={hidden_channels}, out={out_channels})")
    return encoder, projection_head, out_channels

@torch.no_grad()
def compute_dgi_embeddings(pkl_path, encoder, projection_head): # running the graph encoder
    data, node_list, _ = load_graph_bundle(pkl_path)
    x = data.x.to(DEVICE)
    edge_index = data.edge_index.to(DEVICE)

    node_embs = encoder(x, edge_index)
    if projection_head is not None:
        node_embs = projection_head(node_embs)

    emb_matrix = node_embs.detach().cpu().numpy().astype(np.float32)
    return emb_matrix, node_list, {"edge_index": data.edge_index.detach().cpu(), "data": data}

def node_lookup_key(node):
    file_path = normalize_file_path(node.get("file") or node.get("repoRelativePath") or "")
    name = (node.get("simpleName") or node.get("name") or "").strip()
    kind = (node.get("kind") or "").strip()
    return file_path, name, kind

def build_node_index(node_list, embeddings):
    index = defaultdict(list)
    for idx, node in enumerate(node_list):
        index[node_lookup_key(node)].append(idx)

        file_path = normalize_file_path(node.get("file") or node.get("repoRelativePath") or "")
        simple_name = (node.get("simpleName") or node.get("name") or "").strip()
        kind = (node.get("kind") or "").strip()
        if file_path and simple_name:
            index[(file_path, simple_name, "")].append(idx)
        if file_path and kind:
            index[(file_path, "", kind)].append(idx)

    return index

def cluster_embeddings(embeddings, distance_threshold): # using hierarchical clustering with cosine distance so the threshold directly controls cluster granularity
    if embeddings.shape[0] == 0:
        return np.asarray([], dtype=int)
    model = AgglomerativeClustering(n_clusters=None, linkage="average", metric="cosine", distance_threshold=distance_threshold)
    return model.fit_predict(embeddings)

def rank_cluster_nodes(cluster_indices, embeddings, node_list, edge_index): # ranking nodes within a cluster based on similarity to the cluster centroid and graph degree matrix
    if not cluster_indices:
        return [] # nothing to rank if cluster is empty

    cluster_embeddings = embeddings[np.array(cluster_indices)] # the embeddings of nodes in this cluster
    centroid = cluster_embeddings.mean(axis=0, keepdims=True) # mean embedding of the cluster
    similarity = cosine_similarity(cluster_embeddings, centroid).reshape(-1) # cosine similarity of each node embedding to the centroid

    degree_counts = defaultdict(int)
    if edge_index is not None and edge_index.numel() > 0:
        edge_np = edge_index.cpu().numpy()
        for src, dst in edge_np.T:
            degree_counts[int(src)] += 1
            degree_counts[int(dst)] += 1

    cluster_degrees = np.array([degree_counts.get(int(idx), 0) for idx in cluster_indices], dtype=np.float32) # mapping degrees to the cluster nodes
    # normalizing degrees to [0,1], Min‑Max scaling
    if cluster_degrees.size > 0 and float(cluster_degrees.max()) > float(cluster_degrees.min()):
        degree_scores = (cluster_degrees - cluster_degrees.min()) / (cluster_degrees.max() - cluster_degrees.min())
    else:
        degree_scores = np.zeros_like(cluster_degrees)

    combined = 0.7 * similarity + 0.3 * degree_scores # whatever score i decided upon
    ranked_positions = np.argsort(-combined) # sorting by score descending

    ranked_nodes = []
    for position in ranked_positions:
        idx = int(cluster_indices[position])
        node = node_list[idx]
        ranked_nodes.append(
            {
                "index": idx,
                "id": node.get("id", f"node-{idx}"),
                "name": node.get("simpleName") or node.get("name") or f"node_{idx}",
                "file": normalize_file_path(node.get("file") or node.get("repoRelativePath") or ""),
                "kind": node.get("kind") or "entity",
                "score": float(combined[position]),
            }
        )

    return ranked_nodes

def summarize_cluster(cluster_nodes):
    if not cluster_nodes:
        return "This cluster does not contain any ranked nodes"

    file_prefixes = Counter(extract_module_prefix(node["file"]) for node in cluster_nodes if node.get("file"))
    kinds = Counter((node.get("kind") or "entity") for node in cluster_nodes)
    anchor_names = [node["name"] for node in cluster_nodes[:3] if node.get("name")]

    dominant_modules = ", ".join(name for name, _ in file_prefixes.most_common(2)) or "the same module"
    dominant_kind = kinds.most_common(1)[0][0] if kinds else "entities"
    if anchor_names:
        anchors = ", ".join(anchor_names[:3])
        return (
            f"This cluster groups {len(cluster_nodes)} {dominant_kind}s concentrated in {dominant_modules}, "
            f"with {anchors} acting as the main anchors"
        ) # two fstrings to make horizontal scrolling less tedious

    return f"This cluster groups {len(cluster_nodes)} {dominant_kind}s concentrated in {dominant_modules}"

def build_cluster_tree(embeddings, node_list, edge_index, top_threshold, sub_threshold, min_cluster_size): # building a two level hierarchical cluster tree from node embeddings
    if embeddings.shape[0] == 0:
        return []

    if embeddings.shape[0] == 1:
        ranked = rank_cluster_nodes([0], embeddings, node_list, edge_index)
        return [
            {
                "label": "single-node cluster",
                "indices": [0],
                "summary": summarize_cluster(ranked),
                "nodes": ranked,
                "children": [],
            }
        ]

    top_labels = cluster_embeddings(embeddings, distance_threshold=top_threshold) # returns integer labels for each node, based on a distnace threshold
    clusters = []

    for label in sorted(set(int(x) for x in top_labels)): # processing each top level cluster (identified by a unique label)
        top_indices = np.where(top_labels == label)[0].tolist()
        if not top_indices:
            continue

        ranked_top = rank_cluster_nodes(top_indices, embeddings, node_list, edge_index) # ranking nodes inside this top cluster by centroid similarity and degree
        child_clusters = [] # sub clustering, only for sufficiently large clusters

        if len(top_indices) >= max(2 * min_cluster_size, min_cluster_size + 1):
            sub_embeddings = embeddings[np.array(top_indices)] # the embeddings of nodes belonging only to this top cluster
            sub_labels = cluster_embeddings(sub_embeddings, distance_threshold=sub_threshold) # second clustering pass on the subset
            for sub_label in sorted(set(int(x) for x in sub_labels)): # group by sub cluster label
                local_indices = np.where(sub_labels == sub_label)[0].tolist()
                if len(local_indices) < min_cluster_size:
                    continue
                actual_indices = [top_indices[i] for i in local_indices]
                ranked_children = rank_cluster_nodes(actual_indices, embeddings, node_list, edge_index) # ranking nodes inside this sub cluster
                child_clusters.append(
                    {
                        "label": f"subcluster-{sub_label}",
                        "indices": actual_indices,
                        "summary": summarize_cluster(ranked_children),
                        "nodes": ranked_children,
                        "children": [],
                    }
                )

        if not child_clusters:
            child_clusters = []

        clusters.append(
            {
                "label": f"cluster-{label}",
                "indices": top_indices,
                "summary": summarize_cluster(ranked_top),
                "nodes": ranked_top,
                "children": child_clusters,
            }
        )

    clusters.sort(key=lambda cluster: (-len(cluster["indices"]), cluster["label"]))
    return clusters

def build_commit_embeddings(project_dir, node_list, embeddings): # building embeddings for each commit based on the functions changed in that commit
    analysis_dir = project_dir / DEFAULT_ANALYSIS_SUBDIR
    if not analysis_dir.exists():
        return []

    commit_pattern = re.compile(r"^[a-f0-9]{40}\.json$")
    commit_files = [path for path in sorted(analysis_dir.glob("*.json")) if commit_pattern.match(path.name)]
    if not commit_files:
        return []

    lookup = build_node_index(node_list, embeddings)
    commit_snapshots = []

    for commit_path in commit_files:
        try:
            payload = load_json_file(commit_path) # loads commit analysis json
        except Exception:
            continue

        sha = payload.get("sha") or commit_path.stem # commit hash
        functions = payload.get("functions") or []
        if not isinstance(functions, list) or not functions:
            continue

        matched_embeddings = [] # embeddings of changed functions
        changed_functions: List[Dict[str, Any]] = []

        for func in functions:  # processing each changed function in this commit
            if not isinstance(func, dict):
                continue

            if func.get("changeType") not in {"added", "modified", "removed"}:
                continue
            # extracting identifying fields
            file_path = normalize_file_path(func.get("file") or func.get("repoRelativePath") or "")
            simple_name = (func.get("simpleName") or func.get("name") or "").strip()
            kind = (func.get("kind") or "").strip()
            key_variants = [
                (file_path, simple_name, kind),
                (file_path, simple_name, ""),
                (file_path, "", kind),
            ]

            matched_idx = None
            for key in key_variants:
                candidates = lookup.get(key)
                if candidates:
                    matched_idx = candidates[0] # first matching node
                    break

            if matched_idx is None:
                continue

            matched_embeddings.append(embeddings[int(matched_idx)])
            changed_functions.append(
                {
                    "file": file_path,
                    "name": simple_name or func.get("name") or "unknown",
                    "kind": kind or "entity",
                    "changeType": func.get("changeType"),
                }
            )

        if not matched_embeddings:
            continue

        commit_vector = np.mean(np.stack(matched_embeddings, axis=0), axis=0).astype(np.float32) # averaging the embeddings of all changed functions
        module_prefixes = Counter(extract_module_prefix(item["file"]) for item in changed_functions if item.get("file"))
        commit_snapshots.append(
            {
                "sha": sha,
                "timestamp": payload.get("generatedAt") or payload.get("timestamp") or commit_path.stat().st_mtime,
                "vector": commit_vector,
                "changes": changed_functions,
                "module_prefixes": module_prefixes,
            }
        )

    if len(commit_snapshots) < 2: # need: at least 2 commits to perform clustering
        return commit_snapshots

    commit_matrix = np.vstack([snapshot["vector"] for snapshot in commit_snapshots]).astype(np.float32) # a matrix of commit vectors => l2 normalise them for cosine similarity
    normalized = l2_normalize(commit_matrix)
    labels = AgglomerativeClustering(n_clusters=None, linkage="average", metric="cosine", distance_threshold=0.28).fit_predict(normalized)

    for snapshot, label in zip(commit_snapshots, labels.tolist()):
        snapshot["cluster"] = int(label) # attaching the cluster label to each commit snapshot

    return commit_snapshots

def summarize_commit_group(commits) -> str:
    if not commits:
        return "No commits matched the current graph"

    file_counter = Counter()
    name_counter = Counter()
    for commit in commits:
        for change in commit.get("changes", []):
            if change.get("file"):
                file_counter[extract_module_prefix(change["file"])] += 1
            if change.get("name"):
                name_counter[change["name"]] += 1

    modules = ", ".join(name for name, _ in file_counter.most_common(2)) or "the same module"
    anchors = ", ".join(name for name, _ in name_counter.most_common(3)) or "shared code"
    return f"These commits form a feature branch around {modules}, with {anchors} as the common anchors"

def render_markdown_document(project_id, pkl_path, node_list, embeddings, clusters, commit_snapshots):
    edge_count = 0
    try:
        data, _, _ = load_graph_bundle(pkl_path)
        edge_count = int(data.edge_index.shape[1])
    except Exception:
        edge_count = 0

    lines: List[str] = []
    lines.append(f"# Living Documentation Map for {project_id}")
    lines.append("")
    lines.append("This document is generated from DGI embeddings and graph structure")
    lines.append("")
    lines.append("## Overview")
    lines.append(f"- Nodes: {len(node_list)}")
    lines.append(f"- Edges: {edge_count}")
    lines.append(f"- Top level clusters: {len(clusters)}")
    lines.append(f"- Generated at: {datetime.now(timezone.utc).isoformat()}")
    lines.append("")

    lines.append("## Structural Clusters")
    for cluster_index, cluster in enumerate(clusters, start=1):
        lines.append(f"### {cluster_index}. {cluster['label']}")
        lines.append(cluster["summary"])
        lines.append("")
        top_modules = Counter(extract_module_prefix(node["file"]) for node in cluster["nodes"] if node.get("file"))
        if top_modules:
            lines.append("Key modules: " + ", ".join(name for name, _ in top_modules.most_common(3)))
        lines.append("Representative nodes:")
        for node in cluster["nodes"][:5]:
            lines.append(f"- {node['name']} [{node['kind']}] - {node['file'] or 'unknown file'}")

        if cluster.get("children"):
            lines.append("")
            lines.append("Subclusters:")
            for sub_index, child in enumerate(cluster["children"], start=1):
                lines.append(f"#### {cluster_index}.{sub_index} {child['label']}")
                lines.append(child["summary"])
                for node in child["nodes"][:3]:
                    lines.append(f"- {node['name']} [{node['kind']}] - {node['file'] or 'unknown file'}")

        lines.append("")

    commit_groups = defaultdict(list)
    for snapshot in commit_snapshots:
        label = snapshot.get("cluster")
        if label is None:
            continue
        commit_groups[int(label)].append(snapshot)

    if commit_groups:
        lines.append("## Commit Evolution")
        lines.append("This section appears only when commit history is available for the project")
        lines.append("")

        for group_index, (label, commits) in enumerate(sorted(commit_groups.items(), key=lambda item: (-len(item[1]), item[0])), start=1):
            commits_sorted = sorted(commits, key=lambda item: item.get("timestamp") or 0)
            lines.append(f"### {group_index}. Commit group {label}")
            lines.append(summarize_commit_group(commits_sorted))
            lines.append("")
            for snapshot in commits_sorted[:8]:
                sha = str(snapshot.get("sha", ""))[:12]
                modules = ", ".join(name for name, _ in snapshot.get("module_prefixes", {}).most_common(2))
                lines.append(f"- {sha}: {modules or 'mixed module changes'}")
            lines.append("")
    else:
        lines.append("## Commit Evolution")
        lines.append("No commit history was found, so the timeline feature is omitted for this project")
        lines.append("")

    return "\n".join(lines).strip() + "\n"

def generate_for_project(project_dir, top_threshold, sub_threshold, min_cluster_size): # the same logic explained in eval_clustering_comparison
    pkl_path = ensure_preprocessed_graph(project_dir)
    encoder, projection_head, _ = load_encoder(pkl_path)
    embeddings, node_list, bundle_meta = compute_dgi_embeddings(pkl_path, encoder, projection_head)
    edge_index = bundle_meta.get("edge_index")

    clusters = build_cluster_tree(embeddings, node_list, edge_index, top_threshold=top_threshold, sub_threshold=sub_threshold, min_cluster_size=min_cluster_size)
    commit_snapshots = build_commit_embeddings(project_dir, node_list, embeddings)

    analysis_dir = project_dir / DEFAULT_ANALYSIS_SUBDIR
    analysis_dir.mkdir(parents=True, exist_ok=True)
    markdown = render_markdown_document(project_dir.name, pkl_path, node_list, embeddings, clusters, commit_snapshots)

    markdown_path = analysis_dir / "documentation.md"
    json_path = analysis_dir / "documentation.json"
    markdown_path.write_text(markdown, encoding="utf-8")

    json_payload = {
        "projectId": project_dir.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceGraph": str(pkl_path),
        "nodeCount": int(len(node_list)),
        "embeddingDimension": int(embeddings.shape[1]) if embeddings.ndim == 2 and embeddings.size else 0,
        "clusters": clusters,
        "commitEvolution": [
            {
                "sha": snapshot.get("sha"),
                "cluster": snapshot.get("cluster"),
                "timestamp": snapshot.get("timestamp"),
                "modules": list(snapshot.get("module_prefixes", {}).keys()),
                "changes": snapshot.get("changes", []),
            }
            for snapshot in commit_snapshots
        ],
    }
    dump_json_file(json_path, json_payload)

    print(f"Wrote documentation map: {markdown_path}")
    print(f"Wrote documentation metadata: {json_path}")

    return {
        "projectId": project_dir.name,
        "pklPath": str(pkl_path),
        "markdownPath": str(markdown_path),
        "jsonPath": str(json_path),
        "clusterCount": len(clusters),
        "commitCount": len(commit_snapshots),
    }


def main():
    parser = argparse.ArgumentParser(description="Generate DGI based documentation for code graphs")
    parser.add_argument("--project-id", help="Specific project folder name under the Log-a-Priori appdata root")
    parser.add_argument("--user-id", help="PocketBase users.id, scopes appdata to log-a-priori-desktop-shell/{userId}/{projectId}")
    parser.add_argument("--all", action="store_true", help="Generate documentation for every project found under appdata")
    parser.add_argument("--top-threshold", type=float, default=0.34, help="Cosine distance threshold for top level clustering")
    parser.add_argument("--sub-threshold", type=float, default=0.22, help="Cosine distance threshold for subclusters")
    parser.add_argument("--min-cluster-size", type=int, default=4, help="Minimum cluster size to keep a subcluster")
    args = parser.parse_args()

    projects = discover_projects(user_id=args.user_id)

    if not projects:
        raise FileNotFoundError("No project directories with ts-code-graph.json or preprocessed graphs were found")

    results = []
    for project_dir in projects:
        print(f"Processing {project_dir.name}...")
        try:
            result = generate_for_project(
                project_dir,
                top_threshold=args.top_threshold,
                sub_threshold=args.sub_threshold,
                min_cluster_size=args.min_cluster_size,
            )
            results.append(result)
        except Exception as exc:
            print(f"  Failed: {exc}")

    print(f"Completed documentation generation for {len(results)} project(s)")

if __name__ == "__main__":
    main()