from pathlib import Path
import json
import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel
import os
from sklearn.metrics.pairwise import cosine_similarity
from collections import defaultdict, deque
from train_unsupervised_dgi import load_graph_bundle
import re
from tqdm import tqdm
import pickle
from sklearn.model_selection import train_test_split

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"
TRAIN_QUERIES_JSON = "nl_queries_inductive_train.json"
VAL_QUERIES_JSON = "nl_queries_inductive_val.json"
TEST_QUERIES_JSON = "nl_queries_inductive_test.json"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

SUMMARIZER_MODEL_NAME = "habuiphuc/codet5-code-summarization"
REGENERATE_QUERIES = True # set True to overwrite existing file
MAX_QUERIES = 500 # total queries per project (train + test)
MIN_QUERIES = 10 # absolute lower bound
CANDIDATE_PERCENTAGE = 0.6 # 60% of candidate nodes
SEED = 42
MAX_CODE_CHARS = 4000
SUM_MAX_INPUT_TOKENS = 512 # further truncation
SUM_MAX_NEW_TOKENS = 48 # the generated summary length
SUM_NUM_BEAMS = 4 # for beam search
SUM_BATCH_SIZE = 8 # SUM_BATCH_SIZE functions at a time
CANDIDATE_MULTIPLIER = 2 # summarize up to MAX_QUERIES*CANDIDATE_MULTIPLIER and keep best MAX_QUERIES
TRAIN_RATIO = 0.8
VAL_RATIO = 0.1
TEST_RATIO = 0.1

def get_dynamic_max_queries(num_candidates): # project specific n_queries as 60% of candidate nodes clamped between MIN_QUERIES and MAX_QUERIES
    base = int(num_candidates * CANDIDATE_PERCENTAGE)
    return max(MIN_QUERIES, min(MAX_QUERIES, base))

def compute_node_degrees(pkl_path):
    with open(pkl_path, 'rb') as f:
        bundle = pickle.load(f)
    if "x" in bundle and "edge_index" in bundle:
        edge_index = bundle["edge_index"]
        node_list = bundle.get("node_list", [])
    elif "data" in bundle:
        edge_index = bundle["data"].edge_index
        node_list = bundle.get("node_list", [])
    else:
        raise ValueError("Cannot extract edge_index from bundle")

    if hasattr(edge_index, 'cpu'):
        edge_np = edge_index.cpu().numpy()
    else:
        edge_np = np.array(edge_index)

    degree = defaultdict(int)
    for src, dst in edge_np.T:
        degree[src] += 1
        degree[dst] += 1

    id_to_degree = {}
    for i, node in enumerate(node_list):
        if isinstance(node, dict) and 'id' in node:
            id_to_degree[node['id']] = degree.get(i, 0)
    return id_to_degree

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

def load_summarizer(model_name): # seq2seq summarization
    from transformers import AutoTokenizer as SumTokenizer, AutoModelForSeq2SeqLM
    sum_tokenizer = SumTokenizer.from_pretrained(model_name)
    sum_model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(DEVICE)
    sum_model.eval()
    return sum_tokenizer, sum_model

def summarize_prompts(prompts, sum_tokenizer, sum_model, pbar=None): # running the seq2seq summarizer on a list of code prompts
    summaries = []
    with torch.inference_mode():
        for i in range(0, len(prompts), SUM_BATCH_SIZE):
            batch = prompts[i:i+SUM_BATCH_SIZE]
            inputs = sum_tokenizer(batch, return_tensors='pt', padding=True, truncation=True, max_length=SUM_MAX_INPUT_TOKENS).to(DEVICE)
            gen_ids = sum_model.generate(**inputs, max_new_tokens=SUM_MAX_NEW_TOKENS, num_beams=SUM_NUM_BEAMS, early_stopping=True)
            texts = sum_tokenizer.batch_decode(gen_ids, skip_special_tokens=True)
            summaries.extend([t.strip() for t in texts])
            if pbar:
                pbar.update(len(batch))
    return summaries

# adapted for any project
def generate_query_pairs_for_project(pkl_path, tokenizer, model): # returns a list of (query_text, node_id) pairs for the given project
    print(f"Loading graph bundle: {pkl_path}")
    data, node_list, _ = load_graph_bundle(pkl_path)
    raw_emb = data.x.detach().cpu().numpy().astype(np.float32)

    candidate_indices = [i for i, node in enumerate(node_list) if node.get('code') and (node.get('kind') in {"function", "method"})]
    num_candidates = len(candidate_indices)
    print(f"Candidate nodes: {num_candidates}")
    if not candidate_indices:
        return []
    
    n_queries = get_dynamic_max_queries(num_candidates) # dynamic MAX_QUERIES based on 60% of candidates
    print(f"Using n_queries = {n_queries} (60% of {num_candidates}, clamped to 10-500)")
    
    # sampling more candidates than needed, then filtering by similarity
    n_candidates = min(num_candidates, max(n_queries, n_queries * CANDIDATE_MULTIPLIER))
    rng = np.random.default_rng(SEED)
    selected = rng.choice(candidate_indices, size=n_candidates, replace=False).tolist()

    print(f"Summarizing {len(selected)} nodes with {SUMMARIZER_MODEL_NAME} ...")
    sum_tokenizer, sum_model = load_summarizer(SUMMARIZER_MODEL_NAME)
    prompts = []
    selected_ids = []
    for i in tqdm(selected, desc="Preparing code prompts", leave=False):
        node = node_list[i]
        code = (node.get('code') or '').strip()
        if len(code) > MAX_CODE_CHARS:
            code = code[:MAX_CODE_CHARS]
        prompts.append(code)
        selected_ids.append(node['id'])
    with tqdm(total=len(selected), desc="Generating summaries", leave=False) as pbar:
        query_texts = summarize_prompts(prompts, sum_tokenizer, sum_model, pbar=pbar)
    query_texts = [re.sub(r'\s+', ' ', q).strip() for q in query_texts]

    # keeping the summaries that are most aligned with the raw code embeddings
    print("\nEmbedding generated queries...")
    q_emb = embed_unixcoder_texts(query_texts, tokenizer, model)
    code_emb = raw_emb[np.array(selected)]
    print("Ranking summaries by similarity...")
    sims = cosine_similarity(q_emb, code_emb).diagonal() # computing the similarity between generated queries and original code embeddings
    ranked = sorted(zip(selected, selected_ids, query_texts, sims), key=lambda x: float(x[3]), reverse=True)
    ranked = ranked[:n_queries] # trimming to MAX_QUERIES

    pairs = []
    for (_, node_id, q, _) in ranked: # for building a list of (query_text, node_id)
        q = (q or '').strip()
        if not q:
            continue
        pairs.append((q, node_id))

    unique_pairs = []
    seen_queries = set() # deduplicating by query text
    for q, nid in pairs:
        if q not in seen_queries:
            seen_queries.add(q)
            unique_pairs.append((q, nid))
    return unique_pairs

def save_queries(pairs, file_path):
    queries_dict = {query: node_id for query, node_id in pairs}
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(queries_dict, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(queries_dict)} queries to {file_path}")

def random_split_pairs(pairs, train_ratio=TRAIN_RATIO, val_ratio=VAL_RATIO, seed=SEED):
    n_total = len(pairs)
    rng = np.random.default_rng(seed)
    shuffled = pairs.copy()
    rng.shuffle(shuffled)
    n_train = int(n_total * train_ratio)
    n_val = int(n_total * val_ratio)
    train_pairs = shuffled[:n_train]
    val_pairs = shuffled[n_train:n_train + n_val]
    test_pairs = shuffled[n_train + n_val:]
    return train_pairs, val_pairs, test_pairs

def can_stratified_train_test_split(labels, test_size):
    # sklearn needs at least one sample per class in both train and test partitions
    from collections import Counter
    counts = Counter(labels)
    n = len(labels)
    n_classes = len(counts)
    if n_classes < 2 or any(c < 2 for c in counts.values()):
        return False
    if isinstance(test_size, float):
        if test_size <= 0 or test_size >= 1:
            return False
        n_test = int(np.round(n * test_size))
    else:
        n_test = int(test_size)
    n_test = max(1, min(n_test, n - 1))
    n_train = n - n_test
    return n_test >= n_classes and n_train >= n_classes

def stratified_split_by_degree(pairs, pkl_path, train_ratio=TRAIN_RATIO, val_ratio=VAL_RATIO, seed=SEED): # splitting query pairs into train/ val/ test using global stratified split and buckets
    id_to_degree = compute_node_degrees(pkl_path)

    # assigning each pair a bucket based on target node degree
    def degree_bucket(deg):
        if deg <= 5:
            return 'low'
        elif deg <= 15:
            return 'medium'
        else:
            return 'high'
        
    n_total = len(pairs)
    buckets = [degree_bucket(id_to_degree.get(nid, 0)) for _, nid in pairs]
    holdout_ratio = 1 - train_ratio
    val_ratio_of_temp = val_ratio / (val_ratio + (1 - train_ratio - val_ratio))

    if not can_stratified_train_test_split(buckets, test_size=holdout_ratio):
        print("\tStratified split infeasible (too few queries per degree bucket); using random split")
        return random_split_pairs(pairs, train_ratio, val_ratio, seed)

    try:
        train_idx, temp_idx = train_test_split(range(n_total), test_size=holdout_ratio, stratify=buckets, random_state=seed)
    except ValueError:
        print("\tStratified train/ holdout split failed, using random split")
        return random_split_pairs(pairs, train_ratio, val_ratio, seed)

    temp_pairs = [pairs[i] for i in temp_idx]
    temp_buckets = [buckets[i] for i in temp_idx]

    if not can_stratified_train_test_split(temp_buckets, test_size=(1 - val_ratio_of_temp)):
        print("\tStratified val/ test split infeasible, using random split")
        return random_split_pairs(pairs, train_ratio, val_ratio, seed)

    try:
        val_idx, test_idx = train_test_split(range(len(temp_pairs)), test_size=(1 - val_ratio_of_temp), stratify=temp_buckets, random_state=seed)
    except ValueError:
        print("\tStratified val/test split failed; using random split")
        return random_split_pairs(pairs, train_ratio, val_ratio, seed)

    train_pairs = [pairs[i] for i in train_idx]
    val_pairs = [temp_pairs[i] for i in val_idx]
    test_pairs = [temp_pairs[i] for i in test_idx]
    return train_pairs, val_pairs, test_pairs

def print_split_stats(pairs, name, pkl_path=None):
    queries = [q for q, _ in pairs]
    lengths = [len(q.split()) for q in queries]
    print(f"{name}: {len(pairs)} queries, avg length = {np.mean(lengths):.2f} (+/-{np.std(lengths):.2f})")
    if pkl_path:
        id_to_degree = compute_node_degrees(pkl_path)
        degrees = [id_to_degree.get(nid, 0) for _, nid in pairs]
        print(f"\tavg target degree = {np.mean(degrees):.2f} (+/-{np.std(degrees):.2f})")

print(f"Base directory: {BASE_DIR}")

pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl"))
if not pkl_files:
    print("No preprocessed graph pickles found, run preprocess_graphs.py first")
    exit()

print("\nLoading UniXcoder for query embedding...")
unix_tokenizer = AutoTokenizer.from_pretrained("microsoft/unixcoder-base")
unix_model = AutoModel.from_pretrained("microsoft/unixcoder-base").to(DEVICE)
unix_model.eval()

for pkl_path in tqdm(pkl_files, desc="Generating inductive queries"):
    project_dir = pkl_path.parent
    project_id = project_dir.name
    train_path = project_dir / TRAIN_QUERIES_JSON
    val_path = project_dir / VAL_QUERIES_JSON
    test_path = project_dir / TEST_QUERIES_JSON

    print(f"\nProcessing project: {project_id}")
    if train_path.exists() and val_path.exists() and test_path.exists():
            print(f"Skipping {project_dir.name} - train/ val/ test queries already exist")
            continue
    else:
        print("\tGenerating queries...")
        pairs = generate_query_pairs_for_project(pkl_path, unix_tokenizer, unix_model)
        if len(pairs) < 2:
            print(f"Not enough query pairs ({len(pairs)}), skipping")
            continue

        train_pairs, val_pairs, test_pairs = stratified_split_by_degree(pairs, pkl_path)
        
        id_to_degree = compute_node_degrees(pkl_path) # computing the degree distribution for this project (to verify stratification)
        for name, split_pairs in [("Train", train_pairs), ("Validation", val_pairs), ("Test", test_pairs)]:
            if not split_pairs:
                continue
            degrees = [id_to_degree[nid] for _, nid in split_pairs]
            low = sum(1 for d in degrees if d <= 5)
            medium = sum(1 for d in degrees if 6 <= d <= 15)
            high = sum(1 for d in degrees if d > 15)
            print(f"\t{name} degree buckets: low={low}, medium={medium}, high={high}")
        save_queries(train_pairs, train_path)
        save_queries(val_pairs, val_path)
        save_queries(test_pairs, test_path)

        print(f"Split statistics (stratified by node degree):")
        print_split_stats(train_pairs, "Train", pkl_path)
        print_split_stats(val_pairs, "Validation", pkl_path)
        print_split_stats(test_pairs, "Test", pkl_path)
    print("Query generation complete")