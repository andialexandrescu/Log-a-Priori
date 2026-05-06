from pathlib import Path
import json
import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel
import os
from sklearn.metrics.pairwise import cosine_similarity
from collections import defaultdict, deque
from train_dgi_v1 import load_graph_bundle
from train_dgi_v1 import GCNEncoder
import re

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell"
QUERIES_JSON = "nl_queries.json"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

SUMMARIZER_MODEL_NAME = "habuiphuc/codet5-code-summarization"
REGENERATE_QUERIES = True # set True to overwrite existing file
MAX_QUERIES = 60 # final number of query, node_id pairs to write
SEED = 42
MAX_CODE_CHARS = 4000
SUM_MAX_INPUT_TOKENS = 512 # further truncation
SUM_MAX_NEW_TOKENS = 48 # the generated summary length
SUM_NUM_BEAMS = 4 # for beam search
SUM_BATCH_SIZE = 8 # SUM_BATCH_SIZE functions at a time
CANDIDATE_MULTIPLIER = 2 # summarize up to MAX_QUERIES*CANDIDATE_MULTIPLIER and keep best MAX_QUERIES

def masked_mean_pool(last_hidden_state, attention_mask):
    mask = attention_mask.unsqueeze(-1).to(last_hidden_state.dtype) # expand shape to the same shape as the hidden state
    summed = (last_hidden_state * mask).sum(dim=1) # sum of real tokens
    denom = mask.sum(dim=1).clamp(min=1.0) # number of real tokens
    return summed/denom # mean pool

def embed_unixcoder_texts(texts, tokenizer, model, max_len=512, batch_size=32): # encoding a list of nl texts into UniXCoder embeddings using mean pooling
    # uses pre loaded tokenizer, model
    out = []
    with torch.inference_mode():
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            inputs = tokenizer(batch, return_tensors='pt', padding=True, truncation=True, max_length=max_len).to(DEVICE)
            outputs = model(**inputs)
            pooled = masked_mean_pool(outputs.last_hidden_state, inputs['attention_mask'])
            out.append(pooled.cpu().numpy().astype(np.float32))
    return np.vstack(out) # dim (len(texts), 768)

def embed_query_unixcoder(text, tokenizer, model, max_len=512): # embedding a single natural language query using the shared UniXcoder model
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=max_len).to(DEVICE)
    with torch.no_grad():
        outputs = model(**inputs)
    mask = inputs["attention_mask"].unsqueeze(-1).to(outputs.last_hidden_state.dtype)
    emb = (outputs.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)
    return emb.squeeze().cpu().numpy().astype(np.float32)

def load_summarizer(model_name): # seq2seq summarization
    from transformers import AutoTokenizer as SumTokenizer, AutoModelForSeq2SeqLM
    sum_tokenizer = SumTokenizer.from_pretrained(model_name)
    sum_model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(DEVICE)
    sum_model.eval()
    return sum_tokenizer, sum_model

def summarize_prompts(prompts, sum_tokenizer, sum_model): # running the seq2seq summarizer on a list of code prompts
    summaries = []
    with torch.inference_mode():
        for i in range(0, len(prompts), SUM_BATCH_SIZE):
            batch = prompts[i:i+SUM_BATCH_SIZE]
            inputs = sum_tokenizer(batch, return_tensors='pt', padding=True, truncation=True, max_length=SUM_MAX_INPUT_TOKENS).to(DEVICE)
            gen_ids = sum_model.generate(**inputs, max_new_tokens=SUM_MAX_NEW_TOKENS, num_beams=SUM_NUM_BEAMS, early_stopping=True)
            texts = sum_tokenizer.batch_decode(gen_ids, skip_special_tokens=True)
            summaries.extend([t.strip() for t in texts])
    return summaries

# adapted for any project
def generate_queries_for_project(pkl_path, queries_path, tokenizer, model):
    # creating nl_queries.json for a single project using CodeT5 summarization
    print(f"Loading graph bundle: {pkl_path}")
    data, node_list, _ = load_graph_bundle(pkl_path)
    raw_emb = data.x.detach().cpu().numpy().astype(np.float32) # pre computed UniXcoder embeddings of all code nodes

    candidate_indices = [i for i, node in enumerate(node_list) if node.get('code') and (node.get('kind') in {"function", "method"})]
    print(f"Candidate nodes: {len(candidate_indices)}")
    
    # seq2seq: summarize code using CodeT5 for selected nodes
    n_candidates = min(len(candidate_indices), max(MAX_QUERIES, MAX_QUERIES*CANDIDATE_MULTIPLIER))
    rng = np.random.default_rng(SEED)
    selected = rng.choice(candidate_indices, size=n_candidates, replace=False).tolist()

    print(f"Summarizing {len(selected)} nodes with {SUMMARIZER_MODEL_NAME} (first run downloads the model)")
    sum_tokenizer, sum_model = load_summarizer(SUMMARIZER_MODEL_NAME)
    prompts = []
    selected_ids = []
    for i in selected:
        node = node_list[i]
        code = (node.get('code') or '').strip()
        if len(code) > MAX_CODE_CHARS:
            code = code[:MAX_CODE_CHARS]
        prompts.append(code)
        selected_ids.append(node['id'])
    query_texts = summarize_prompts(prompts, sum_tokenizer, sum_model)
    query_texts = [re.sub(r'\s+', ' ', q).strip() for q in query_texts]

    # keeping the summaries that are most aligned with the raw code embeddings
    q_emb = embed_unixcoder_texts(query_texts, tokenizer, model)
    code_emb = raw_emb[np.array(selected)]
    sims = cosine_similarity(q_emb, code_emb).diagonal()
    ranked = sorted(zip(selected, selected_ids, query_texts, sims), key=lambda x: float(x[3]), reverse=True)
    ranked = ranked[:MAX_QUERIES] # trimming to MAX_QUERIES
    selected = [i for i, _, _, _ in ranked]
    selected_ids = [nid for _, nid, _, _ in ranked]
    query_texts = [qt for _, _, qt, _ in ranked]
    print(f"Selected top {len(query_texts)} summaries by UniXcoder similarity")

    queries = {}
    for idx, (q, node_id) in enumerate(zip(query_texts, selected_ids)):
        q = (q or '').strip()
        if not q:
            continue
        if q in queries:
            node = node_list[selected[idx]]
            file_name = Path(node.get('filePath','')).name
            simple = node.get('simpleName') or node.get('name') or ''
            suffix = f" ({simple or file_name})"
            q2 = q + suffix
            n = 2
            while q2 in queries:
                q2 = f"{q}{suffix} #{n}"
                n += 1
            q = q2 # deduplicating keys
        queries[q] = node_id

    with queries_path.open('w', encoding='utf-8') as f:
        json.dump(queries, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(queries)} queries to: {queries_path}")
    print("Sample:")
    for k, v in list(queries.items())[:5]:
        print("\t", k, "=>", v)

    return True

# ground truth
def get_true_cluster(target_idx, edge_index): # ground truth target node + its 1 hop neighbours
    edge_np = edge_index.cpu().numpy()
    true = {target_idx}
    for src, dst in edge_np.T:
        if src == target_idx:
            true.add(int(dst))
        if dst == target_idx:
            true.add(int(src))
    return true

# used for dgi
def get_connected_component_set(node_idx, edge_index): # set of all node indices in the same connected component as node_idx
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

# used for dgi
def filter_by_connectivity(node_indices, edge_index): # putting node_indices into connected components based on graph connectivity
    components = {}
    visited_global = set()
    comp_id = 0
    for node_idx in node_indices:
        if node_idx in visited_global:
            continue
        component = get_connected_component_set(node_idx, edge_index)
        filtered = component & set(node_indices)
        if filtered:
            components[comp_id] = filtered
            visited_global.update(filtered)
            comp_id += 1
    return components

def retrieve_dgi_cluster_from_query(q_emb, raw_emb, dgi_emb, edge_index, top_k_dgi=20):
    sim_raw = cosine_similarity([q_emb], raw_emb)[0]
    seed_idx = int(np.argmax(sim_raw)) # seed = argmax similarity between query and raw embeddings

    sim_dgi = cosine_similarity([dgi_emb[seed_idx]], dgi_emb)[0]
    sim_dgi[seed_idx] = -np.inf
    top_indices = set(np.argsort(-sim_dgi)[:top_k_dgi].tolist()) # dgi neighbours
    
    top_indices.add(seed_idx) # including the seed itself
    
    components = filter_by_connectivity(list(top_indices), edge_index) # finding connected component that contains the seed
    for comp_nodes in components.values():
        if seed_idx in comp_nodes:
            return comp_nodes
    return set() # fallback

# used for UniXcoder
def retrieve_raw_knn_cluster(target_idx, raw_emb, k): # retrieve top k nearest neighbours of the target node in raw embedding space
    if k <= 0:
        return set()
    N = raw_emb.shape[0]
    if k >= N:
        return set([i for i in range(N) if i != target_idx])
    sim = cosine_similarity([raw_emb[target_idx]], raw_emb)[0]
    sim[target_idx] = -np.inf
    topk_idx = np.argsort(-sim)[:k]
    return set(topk_idx)

print(f"Base directory: {BASE_DIR}")

pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl"))
if not pkl_files:
    print("No preprocessed graph pickles found, run preprocess-graphs.py first")

encoder_path = BASE_DIR / "dgi_encoder_universal.pt"
if not encoder_path.exists():
    print(f"DGI encoder not found at {encoder_path}, run train-dgi.py first")

sample_pkl = pkl_files[0]
sample_data, _, _ = load_graph_bundle(sample_pkl)
in_channels = sample_data.num_features
HIDDEN_CHANNELS, OUT_CHANNELS = 256, 512

encoder = GCNEncoder(in_channels, HIDDEN_CHANNELS, OUT_CHANNELS).to(DEVICE)
encoder.load_state_dict(torch.load(encoder_path, map_location=DEVICE))
encoder.eval()
print(f"Loaded DGI encoder from {encoder_path}")

print("\nLoading UniXcoder for query embedding...")
unix_tokenizer = AutoTokenizer.from_pretrained("microsoft/unixcoder-base")
unix_model = AutoModel.from_pretrained("microsoft/unixcoder-base").to(DEVICE)
unix_model.eval()

overall_results = {
    "dgi_f1": [], "dgi_recall": [], "dgi_precision": [],
    "uni_f1": [], "uni_recall": [], "uni_precision": []
}
per_project_results = []
detailed_log = []

for pkl_path in pkl_files:
    project_dir = pkl_path.parent
    project_id = project_dir.name
    queries_path = project_dir / QUERIES_JSON
    print(f"\nProcessing project: {project_id}")
    if not queries_path.exists():
        print("  Generating queries...")
        success = generate_queries_for_project(pkl_path, queries_path, unix_tokenizer, unix_model)
        if not success:
            print("  Skipping project (no suitable nodes).")
            continue
    with open(queries_path, "r", encoding="utf-8") as f:
        queries = json.load(f)
    print(f"  Loaded {len(queries)} queries")

    data, node_list, _ = load_graph_bundle(pkl_path)
    raw_emb = data.x.cpu().numpy()
    edge_index = data.edge_index

    with torch.no_grad():
        dgi_emb = encoder(data.x.to(DEVICE), edge_index.to(DEVICE)).cpu().numpy()

    id_to_idx = {}
    for i, node in enumerate(node_list):
        id_to_idx[node['id']] = i

    proj_dgi_f1, proj_uni_f1 = [], []
    proj_dgi_rec, proj_uni_rec = [], []
    proj_dgi_prec, proj_uni_prec = [], []

    for q_text, target_node_id in queries.items():
        if target_node_id not in id_to_idx:
            continue
        target_idx = id_to_idx[target_node_id]

        true_cluster = get_true_cluster(target_idx, edge_index)
        degree = len(true_cluster) - 1
        if degree == 0:
            continue

        q_emb = embed_query_unixcoder(q_text, unix_tokenizer, unix_model)

        dgi_retrieved = retrieve_dgi_cluster_from_query(q_emb, raw_emb, dgi_emb, edge_index, top_k_dgi=20)
        raw_retrieved = retrieve_raw_knn_cluster(target_idx, raw_emb, k=degree)
        
        def get_node_name(idx):
            return node_list[idx].get('simpleName') or node_list[idx].get('name') or f"node_{idx}"

        sim_raw = cosine_similarity([q_emb], raw_emb)[0]
        seed_idx = int(np.argmax(sim_raw))
        seed_name = get_node_name(seed_idx)

        dgi_names = [get_node_name(i) for i in sorted(dgi_retrieved)]
        raw_names = [get_node_name(i) for i in sorted(raw_retrieved)]

        print()
        print(f"Query: {q_text}")
        print(f"\tSeed (UniXcoder): {seed_name}")
        print(f"\tDGI retrieved ({len(dgi_names)}): {', '.join(dgi_names)}")
        print(f"\tRaw UniXcoder retrieved ({len(raw_names)}): {', '.join(raw_names)}")
        
        def metrics(retrieved, true):
            inter = len(retrieved & true)
            rec = inter/len(true) if true else 0.0
            prec = inter/len(retrieved) if retrieved else 0.0
            f1 = 2*prec*rec/(prec+rec) if (prec+rec) > 0 else 0.0
            return rec, prec, f1

        dgi_rec, dgi_prec, dgi_f1 = metrics(dgi_retrieved, true_cluster)
        uni_rec, uni_prec, uni_f1 = metrics(raw_retrieved, true_cluster)

        proj_dgi_f1.append(dgi_f1)
        proj_dgi_rec.append(dgi_rec)
        proj_dgi_prec.append(dgi_prec)
        proj_uni_f1.append(uni_f1)
        proj_uni_rec.append(uni_rec)
        proj_uni_prec.append(uni_prec)

        overall_results["dgi_f1"].append(dgi_f1)
        overall_results["dgi_recall"].append(dgi_rec)
        overall_results["dgi_precision"].append(dgi_prec)
        overall_results["uni_f1"].append(uni_f1)
        overall_results["uni_recall"].append(uni_rec)
        overall_results["uni_precision"].append(uni_prec)

        log_entry = {
            "project": project_id,
            "query": q_text,
            "target_node_id": target_node_id,
            "true_cluster_size": len(true_cluster),
            "true_cluster_indices": [int(i) for i in true_cluster],
            "dgi_retrieved_size": len(dgi_retrieved),
            "dgi_retrieved_indices": [int(i) for i in dgi_retrieved],
            "uni_retrieved_size": len(raw_retrieved),
            "uni_retrieved_indices": [int(i) for i in raw_retrieved],
            "dgi_recall": dgi_rec,
            "dgi_precision": dgi_prec,
            "dgi_f1": dgi_f1,
            "uni_recall": uni_rec,
            "uni_precision": uni_prec,
            "uni_f1": uni_f1,
        }
        detailed_log.append(log_entry)

    if proj_dgi_f1:
        proj_results = {
            "project_id": project_id,
            "num_queries": len(proj_dgi_f1),
            "dgi_f1": (np.mean(proj_dgi_f1), np.std(proj_dgi_f1)),
            "uni_f1": (np.mean(proj_uni_f1), np.std(proj_uni_f1)),
            "dgi_recall": (np.mean(proj_dgi_rec), np.std(proj_dgi_rec)),
            "uni_recall": (np.mean(proj_uni_rec), np.std(proj_uni_rec)),
            "dgi_precision": (np.mean(proj_dgi_prec), np.std(proj_dgi_prec)),
            "uni_precision": (np.mean(proj_uni_prec), np.std(proj_uni_prec)),
        }
        per_project_results.append(proj_results)

overall_agg = {}
for key in ["dgi_f1", "dgi_recall", "dgi_precision", "uni_f1", "uni_recall", "uni_precision"]:
    arr = overall_results[key]
    overall_agg[key] = (np.mean(arr), np.std(arr))
overall_agg["total_queries"] = len(overall_results["dgi_f1"])

print("Results for all projects")
print(f"{'Metric':<25s} {'Mean':<12s} {'Std':<12s}")
for key in ["dgi_f1", "dgi_recall", "dgi_precision", "uni_f1", "uni_recall", "uni_precision"]:
    m, s = overall_agg[key]
    print(f"{key:<25s} {m:.4f}      {s:.4f}")
print(f"Total queries evaluated: {overall_agg['total_queries']}")

overall_serializable = {}
for k, v in overall_agg.items():
    if k == "total_queries":
        overall_serializable[k] = v
    else:
        overall_serializable[k] = [float(v[0]), float(v[1])]

output_file = BASE_DIR / "hybrid_retrieval_evaluation.json"
with open(output_file, "w", encoding="utf-8") as f:
    json.dump({
        "overall": overall_serializable,
        "per_project": per_project_results,
        "per_query": detailed_log
    }, f, indent=2, ensure_ascii=False)
print(f"\nDetailed results saved to: {output_file}")