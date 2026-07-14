import json
import sys
import os
from pathlib import Path
from collections import defaultdict, deque
import numpy as np
import torch
from sklearn.metrics.pairwise import cosine_similarity
from graph_embeddings import BASE_DIR, ensure_preprocessed_graph, resolve_shared_model_path
from train_unsupervised_dgi import load_graph_bundle
from train_query_projection import QueryProjection

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

def resolve_project_dir(project_id):
    user_id = os.environ.get("PROJECT_OWNER_USER_ID", "").strip()
    if user_id:
        return BASE_DIR / user_id / project_id
    return BASE_DIR / project_id

def get_seed_one_hop_cluster(seed_idx, edge_index): # seeding the node plus its immediate graph neighbours, same as eval get_true_cluster
    seed_idx = int(seed_idx)
    edge_np = edge_index.cpu().numpy()
    cluster = {seed_idx}
    for src, dst in edge_np.T:
        if int(src) == seed_idx:
            cluster.add(int(dst))
        if int(dst) == seed_idx:
            cluster.add(int(src))
    return cluster

def get_connected_component_set(node_idx, edge_index): # all candidate nodes must stay inside the same connected component as the seed
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

def select_adaptive_topk_from_scores(scores, exclude_indices=None, max_scan=50, min_k=1): # score elbow selection
    scores = np.asarray(scores)
    n = scores.shape[0]
    if n == 0:
        return set(), 0

    candidate_idx = np.arange(n)
    if exclude_indices is not None:
        exclude_indices = np.atleast_1d(np.array(list(exclude_indices), dtype=int))
        if exclude_indices.size > 0:
            mask = np.ones(n, dtype=bool)
            mask[exclude_indices[(exclude_indices >= 0) & (exclude_indices < n)]] = False
            candidate_idx = candidate_idx[mask]

    if candidate_idx.size == 0:
        return set(), 0

    finite_mask = np.isfinite(scores[candidate_idx])
    candidate_idx = candidate_idx[finite_mask]
    if candidate_idx.size == 0:
        return set(), 0

    order = np.argsort(-scores[candidate_idx], kind="mergesort")
    ranked_idx = candidate_idx[order]
    ranked_scores = scores[ranked_idx]

    scan_n = min(int(max_scan), ranked_idx.size)
    if scan_n <= 0:
        return set(), 0

    ranked_idx = ranked_idx[:scan_n]
    ranked_scores = ranked_scores[:scan_n]

    if scan_n <= min_k:
        return set(int(i) for i in ranked_idx), scan_n

    gaps = ranked_scores[:-1] - ranked_scores[1:]
    if gaps.size == 0:
        cutoff = 1
    else:
        smoothed = gaps.copy()
        if gaps.size >= 3:
            smoothed[1:-1] = (gaps[:-2] + gaps[1:-1] + gaps[2:]) / 3.0

        positions = np.arange(smoothed.size, dtype=np.float32)
        early_bias = 1.0 / np.log2(positions + 2.0)
        knee_scores = smoothed * early_bias
        knee_pos = int(np.argmax(knee_scores))
        cutoff = max(int(min_k), knee_pos + 1)

    selected = set(int(i) for i in ranked_idx[:cutoff])
    return selected, cutoff

def normalize_scores(scores):
    # normalize score arrays when a downstream diagnostic wants a 0-1 view of the ranking
    scores = np.asarray(scores, dtype=np.float32)
    if scores.size == 0:
        return scores
    min_score = float(np.min(scores))
    max_score = float(np.max(scores))
    if np.isclose(max_score, min_score):
        return np.zeros_like(scores)
    return (scores - min_score) / (max_score - min_score)

def raw_seed_ppr_scores(q_emb_proj, raw_emb, edge_index, *, num_seeds = 1, alpha = 0.85, iterations = 30):
    N = raw_emb.shape[0]

    sim_raw = cosine_similarity([q_emb_proj], raw_emb)[0]
    seed_indices = np.argsort(-sim_raw)[:num_seeds]

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
        r_new = (1 - alpha) * r0
        r_contrib = np.zeros(N)
        for i in range(N):
            if deg[i] > 0 and r[i] != 0:
                contrib = r[i] / deg[i]
                for j in adj[i]:
                    r_contrib[j] += contrib
        r_new += alpha * r_contrib
        r = r_new

    return r, int(seed_indices[0])

def retrieve_raw_seed_ppr_cluster(q_emb_proj, raw_emb, edge_index, *, max_scan = 50, min_k = 1, alpha = 0.85, iterations = 30):
    ppr_scores, best_seed = raw_seed_ppr_scores(q_emb_proj, raw_emb, edge_index, num_seeds=1, alpha=alpha, iterations=iterations)
    best_seed = int(best_seed)
    component = get_connected_component_set(best_seed, edge_index)
    seed_local = get_seed_one_hop_cluster(best_seed, edge_index)
    cluster_nodes = seed_local & component
    if not cluster_nodes:
        cluster_nodes = {best_seed}

    requested_k = max(1, int(min_k))
    local_size = len(cluster_nodes)
    cutoff = local_size

    if requested_k > local_size:
        masked_scores = np.asarray(ppr_scores, dtype=np.float64).copy()
        for idx in cluster_nodes:
            masked_scores[int(idx)] = -np.inf
        extra, elbow_cut = select_adaptive_topk_from_scores(masked_scores, max_scan=max_scan, min_k=requested_k - local_size)
        cluster_nodes |= {int(i) for i in extra} & component
        cutoff = int(elbow_cut) + local_size

    return cluster_nodes, int(cutoff), best_seed, ppr_scores

def embed_query_with_projection(query_text, projection_model):
    # project the query into the same vector space used to choose the seed node
    with torch.no_grad():
        emb = projection_model([query_text]).squeeze().cpu().numpy()
    return emb.astype(np.float32)

def raw_ppr_cluster_from_graph(query_text, raw_emb, edge_index, node_list, projection_model, *, top_k_adaptive = True, max_scan = 50, min_k = 1, alpha = 0.85, ppr_iters = 30):
    q_emb_proj = embed_query_with_projection(query_text, projection_model)
    sim_raw = cosine_similarity([q_emb_proj], raw_emb)[0]
    seed_pool_size = 1

    if top_k_adaptive:
        cluster_nodes, cutoff, best_seed, ppr_scores = retrieve_raw_seed_ppr_cluster(q_emb_proj, raw_emb, edge_index, max_scan=max_scan, min_k=min_k, alpha=alpha, iterations=ppr_iters)
    else:
        ppr_scores, best_seed = raw_seed_ppr_scores(q_emb_proj, raw_emb, edge_index, alpha=alpha, iterations=ppr_iters)
        idxs = np.argsort(-ppr_scores)[:10]
        cluster_nodes = set(int(i) for i in idxs)
        cluster_nodes.add(int(best_seed))
        comp = get_connected_component_set(best_seed, edge_index)
        cluster_nodes = cluster_nodes & comp or {int(best_seed)}
        cutoff = len(cluster_nodes)

    seed_indices = np.asarray([best_seed], dtype=np.int64)
    comp = get_connected_component_set(best_seed, edge_index)
    suggested_k = int(len(cluster_nodes))
    if len(comp) > 0:
        suggested_k = int(min(suggested_k, len(comp)))

    try:
        seed_similarities = [float(sim_raw[int(i)]) for i in seed_indices]
    except Exception:
        seed_similarities = []

    def summarize_top(scores, top_n=10):
        idxs = np.argsort(-scores)[:top_n]
        out = []
        for ii in idxs:
            ii = int(ii)
            out.append({
                "idx": ii,
                "nodeId": node_list[ii]["id"],
                "name": node_list[ii].get("simpleName") or node_list[ii].get("name") or f"node_{ii}",
                "score": float(scores[ii]),
            })
        return out

    diagnostics = {
        "seedIndices": [int(x) for x in seed_indices],
        "seedSimilarities": seed_similarities,
        "seedPoolSize": int(seed_pool_size),
        "maxScan": int(max_scan),
        "minK": int(min_k),
        "seedLocalSize": int(len(get_seed_one_hop_cluster(best_seed, edge_index) & comp)),
        "adaptiveCutoff": int(cutoff),
        "topPPR": summarize_top(ppr_scores, top_n=10),
        "topRawSimilarity": summarize_top(sim_raw, top_n=10),
        "selectedCountBeforeConnectivity": int(len(get_seed_one_hop_cluster(best_seed, edge_index))),
        "connectedComponentSize": int(len(comp)),
        "finalClusterIndices": [int(x) for x in sorted(cluster_nodes)],
        "suggestedK": int(suggested_k),
    }

    cluster_node_ids = [node_list[idx]["id"] for idx in cluster_nodes]
    cluster_node_names = [
        node_list[idx].get("simpleName") or node_list[idx].get("name") or f"node_{idx}"
        for idx in cluster_nodes
    ]
    seed_idx = int(seed_indices[0])
    seed_name = node_list[seed_idx].get("simpleName") or node_list[seed_idx].get("name") or f"node_{seed_idx}"
    semantic_score = float(np.mean(sim_raw[list(cluster_nodes)])) if cluster_nodes else None

    return {
        "clusterNodeIds": cluster_node_ids,
        "clusterNodeNames": cluster_node_names,
        "seedNodeId": node_list[seed_idx]["id"],
        "seedNodeName": seed_name,
        "clusterSize": len(cluster_nodes),
        "semanticScore": semantic_score,
        "metadata": {
            "query": query_text,
            "topKDGI": None,
            "simThreshold": None,
            "algorithm": "raw_seed_ppr",
            "seedPoolSize": int(seed_pool_size),
            "alpha": alpha,
            "iterations": ppr_iters,
            "diagnostics": diagnostics,
        },
    }

def raw_ppr_cluster(project_id, query_text, top_k_adaptive=True, max_scan=50, min_k=1, alpha=0.85, ppr_iters=30):
    project_dir = resolve_project_dir(project_id)
    pkl_path = ensure_preprocessed_graph(project_dir)

    data, node_list, _ = load_graph_bundle(pkl_path)
    raw_emb = data.x.cpu().numpy()
    edge_index = data.edge_index

    projection_path = resolve_shared_model_path("seed_projection.pt")
    if not projection_path.exists():
        raise FileNotFoundError(f"Projection model not found at {projection_path}")
    out_channels = data.x.shape[1]
    projection_model = QueryProjection(proj_dim=out_channels, freeze_encoder=True).to(DEVICE)
    projection_model.proj.load_state_dict(torch.load(projection_path, map_location=DEVICE))
    projection_model.eval()

    return raw_ppr_cluster_from_graph(query_text, raw_emb, edge_index, node_list, projection_model, top_k_adaptive=top_k_adaptive, max_scan=max_scan, min_k=min_k, alpha=alpha, ppr_iters=ppr_iters)

if __name__ == "__main__":
    # keep the cli simple because this script is used as a single-query inference entrypoint
    if len(sys.argv) < 4:
        print("Usage: python inference_raw_ppr.py <project_id> query <query_text> [max_scan] [min_k] [alpha] [iterations]")
        sys.exit(1)

    project_id = sys.argv[1]
    mode = sys.argv[2] # should be query
    if mode != "query":
        raise ValueError("Only 'query' mode is supported")

    query_text = sys.argv[3]
    max_scan = int(sys.argv[4]) if len(sys.argv) > 4 else 50
    min_k = int(sys.argv[5]) if len(sys.argv) > 5 else 1
    alpha = float(sys.argv[6]) if len(sys.argv) > 6 else 0.85
    ppr_iters = int(sys.argv[7]) if len(sys.argv) > 7 else 30

    try:
        result = raw_ppr_cluster(project_id, query_text, max_scan=max_scan, min_k=min_k, alpha=alpha, ppr_iters=ppr_iters)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}, indent=2), file=sys.stderr)
        sys.exit(1)