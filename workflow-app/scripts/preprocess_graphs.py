import numpy as np
import matplotlib.pyplot as plt
import torch
import pandas as pd
import os
import gc
import json
import hashlib
from pathlib import Path
import pickle
from torch_geometric.data import Data
from transformers import AutoTokenizer, AutoModel
import glob
import re

MODEL_ID = "microsoft/unixcoder-base"
APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell"
EMBED_CACHE_DIR = 'embed_cache' # the directory where embedding .npy files will be stored
CODEBERT_MAX_LEN = 512 # model's max token limit
CHUNK_OVERLAP = 128 # overlap between chunks (tokens), in order to not separte meaningful code blocks which would otherwise be split into chunks with no info about the missing part
    
def find_all_graph_jsons(appdata_base): # scanning appdata/log-a-priori-desktop-shell for all ts-code-graph.json files only one directory down
    pattern = os.path.join(appdata_base, "*", "analysis", "ts-code-graph.json")
    return glob.glob(pattern)

def load_model(model_id):
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModel.from_pretrained(model_id)
    model.eval()
    if torch.cuda.is_available():
        model.cuda()
        print("gpu")
    else:
        print("cpu")
    return tokenizer, model

def embed_token_chunk(token_ids, attention_mask, model): # computing mean pooled embedding for a token chunk
    input_ids = torch.tensor([token_ids], dtype=torch.long) # transforming a chunk of token ids to a tensor
    attn_mask = torch.tensor([attention_mask], dtype=torch.long) # corresponding attention mask
    if torch.cuda.is_available():
        input_ids = input_ids.cuda()
        attn_mask = attn_mask.cuda()
    with torch.no_grad(): # no need for gradients at the inference step
        outputs = model(input_ids, attention_mask=attn_mask) # passing through codebert, 768 is the output dimension of the codebert model
    
    # mean pooling over token
    masked = outputs.last_hidden_state * attn_mask.unsqueeze(-1) # (1,512,768), because we multiply attention mask with embeddings outputs.last_hidden_state (ignoring padding) => (batch_size, sequence_length, hidden_size) = (1, 512, 768)
    sum_emb = masked.sum(dim=1) # (1,768), summing over the multiplication (only real tokens contribute)
    real_count = attn_mask.sum(dim=1) # (1,), counting real tokens

    emb = sum_emb / real_count.unsqueeze(-1) # (1,768), averaging

    return emb.squeeze().cpu().numpy().astype(np.float32)

def get_code_embedding(code, tokenizer, model, display_flag=True, max_len=CODEBERT_MAX_LEN, overlap=CHUNK_OVERLAP): # return the code embedding for a function and checks if the token count is exceeded, then splits into overlapping chunks using a sliding window
    encoding = tokenizer(code, return_tensors="pt", truncation=False, padding=False) # tokenize full code (without truncation)
    input_ids = encoding["input_ids"][0].tolist()
    total_tokens = len(input_ids)
    if (display_flag): print(f"\tToken count: {total_tokens}")
    
    if total_tokens <= max_len: # if respecting the limit, embed the full code
        inputs = tokenizer(code, return_tensors="pt", truncation=True, max_length=max_len) # transforming to tokens, padded to length CODEBERT_MAX_LEN
        if torch.cuda.is_available():
            inputs = {k: v.cuda() for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        
        emb = outputs.last_hidden_state.mean(dim=1).squeeze().cpu().numpy().astype(np.float32)
        num_chunks = 1
        if (display_flag): print(f"Direct embedding: 1 chunk")
    else:
        chunk_embeddings = [] # chunking is needed
        stride = max_len-overlap
        num_chunks = (total_tokens-max_len+stride-1) // stride + 1
        if (display_flag): print(f"\tChunking with stride={stride}, overlap={overlap}: {num_chunks} chunks")

        for chunk_index, start in enumerate(range(0, total_tokens, stride)):
            end = min(start + max_len, total_tokens)
            chunk_ids = input_ids[start:end]
            attn_mask = [1] * len(chunk_ids)
            pad_len = 0
            if len(chunk_ids) < max_len: # pad only the last chunk to CODEBERT_MAX_LEN if it is needed
                pad_len = max_len - len(chunk_ids)
                chunk_ids.extend([tokenizer.pad_token_id] * pad_len)
                attn_mask.extend([0] * pad_len)
            if (display_flag): print(f"\t\tChunk {chunk_index}: tokens [{start}:{end}] (len={len(chunk_ids)-pad_len}, pad={pad_len})") # overlapping chunks ensure that patterns near chunk boundaries are seen in two chunks, reducing information loss

            emb = embed_token_chunk(chunk_ids, attn_mask, model)
            chunk_embeddings.append(emb)
        
        emb = np.mean(chunk_embeddings, axis=0) # average chunk embeddings
    return emb # every token’s representation is a 768 dimensional vector for codebert

def cache_embedding(node_id, code, tokenizer, model, project_root, display_flag=False): # caching embedding on disk using node_id hash
    # because of this it will prevent recomputing embeddings for the same function across multiple runs
    # the cache embedding will be saved inside the project's specific folder
    if not isinstance(project_root, Path):
        project_root = Path(project_root)
    safe_id = hashlib.md5(node_id.encode()).hexdigest()
    cache_dir = project_root / EMBED_CACHE_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{safe_id}.npy" # one file per function, reusable across projects
    if os.path.exists(cache_path):
        if (display_flag): print(f"Found cache, loading from {cache_path}")
        return np.load(cache_path) # already exists on disk
    if (display_flag): print(f"Computing new embedding for {safe_id[:8]}")
    emb = get_code_embedding(code, tokenizer, model, False) # embedding the code
    if (display_flag): print(f"Saved cache to {cache_path}")
    np.save(cache_path, emb)
    return emb

def embed_nodes_from_json(json_path, tokenizer, model, project_root, display_flag=False): # loading json, generate codebert embeddings for nodes with code
    if not isinstance(project_root, Path):
        project_root = Path(project_root)
    with open(str(json_path), "r", encoding="utf-8") as f:
        data = json.load(f)
    nodes = data["graph"]["nodes"]
    valid_nodes = []
    embeddings = []
    for node in nodes:
        code = node.get("code", "")
        emb = cache_embedding(node["id"], code, tokenizer, model, project_root)
        embeddings.append(emb)
        valid_nodes.append(node)
    if (display_flag): print(f"Processed nodes: {len(valid_nodes)}/ {len(nodes)}")

    # this will become the node feature matrix for the gcn
    X = np.vstack(embeddings).astype(np.float32) # array containing all embeddings, stacking all 768 dim vectors vertically => (num_nodes, 768)
    if (display_flag): print(f"Embedding matrix shape: {X.shape}")
    if (display_flag): print(f"Embedding range: [{X.min():.4f}, {X.max():.4f}]")
    return valid_nodes, X

# most GNN libraries expect a specific graph data structure that includes node features and edge connectivity in a standardised tensor format
def build_homogeneous_graph(edges, id_to_idx): # combining the CALLS and USES edges into a general association between nodes, since they both describe a relationship between functions
    edge_pairs = []
    for edge in edges:
        src = id_to_idx.get(edge["from"])
        dst = id_to_idx.get(edge["to"])
        if src is None or dst is None:
            continue
        edge_pairs.append([src, dst])
        edge_pairs.append([dst, src]) # undirected
    if not edge_pairs:
        return torch.empty((2, 0), dtype=torch.long)
    edge_index = torch.tensor(edge_pairs, dtype=torch.long).t().contiguous()
    return edge_index

def json_to_pyg_data(json_path, valid_nodes, embeddings): # converting json + embeddings to PyG data object
    with open(str(json_path), "r", encoding="utf-8") as f:
        data = json.load(f)
    edges = data["graph"]["edges"]
    id_to_idx = {node["id"]: i for i, node in enumerate(valid_nodes)}
    edge_index = build_homogeneous_graph(edges, id_to_idx)
    x = torch.tensor(embeddings, dtype=torch.float)
    return Data(x=x, edge_index=edge_index), valid_nodes

json_files = [Path(p) for p in find_all_graph_jsons(BASE_DIR)]
print(f"Found {len(json_files)} ts-code-graph.json files")

tokenizer, model = load_model(MODEL_ID) # UniXcoder
# the same as before
for index, jf in enumerate(json_files):
    print(f"\n[{index+1}/{len(json_files)}] Processing: {jf}")
    project_root = jf.parent.parent
    project_id = project_root.name
    print(f"Project root: {project_root}, project: {project_id}")

    valid_nodes, emb_matrix = embed_nodes_from_json(jf, tokenizer, model, project_root)

    pyg_data, node_list = json_to_pyg_data(jf, valid_nodes, emb_matrix) # building Data type graph
    num_edges = pyg_data.edge_index.shape[1]
    print(f"Built graph: {pyg_data.x.shape[0]} nodes, {num_edges} undirected edges")
    
    path_hash = hashlib.md5(str(jf).encode()).hexdigest()[:12]
    out_file = project_root / f"preprocessed-graph-{path_hash}.pkl" # saving all info about nodes of a certain project graph into a single .pkl file
    
    with open(out_file, "wb") as f:
        pickle.dump({
            # "data": pyg_data, # PyG Data object with x embedding + edge_index undirected edges
            "x": pyg_data.x.detach().cpu(), # torch.Tensor (N, 768)
            "edge_index": pyg_data.edge_index.detach().cpu(), # torch.LongTensor (2, E)
            "node_list": node_list, # list of node dicts
            "json_path": jf, # original json path
            "original_embeddings": emb_matrix # (num_nodes, 768) codebert features
        }, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"Saved to: {out_file}")

print(f"Preprocessing is complete")

del model, tokenizer
torch.cuda.empty_cache()
gc.collect()