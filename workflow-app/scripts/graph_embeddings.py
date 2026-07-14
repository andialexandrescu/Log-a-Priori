# acts like a module which does graph preprocessing for inference on unseen projects sinceend user projects typically only have analysis/ts-code-graph.json
from __future__ import annotations
import argparse
import hashlib
import json
import os
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
import torch
from torch_geometric.data import Data

MODEL_ID = "microsoft/unixcoder-base"
APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell"
DEFAULT_ANALYSIS_SUBDIR = "analysis"
GRAPH_JSON_NAME = "ts-code-graph.json"
EMBED_CACHE_DIR = "embed_cache"
PROGRESS_FILE_NAME = ".embedding-progress.json"
CODEBERT_MAX_LEN = 512
CHUNK_OVERLAP = 128

TOKENIZER = None
EMBED_MODEL = None

def resolve_shared_model_path(filename):
    candidates = []
    model_dir = os.environ.get("LOG_A_PRIORI_MODEL_DIR", "").strip()
    if model_dir:
        candidates.append(Path(model_dir) / filename)

    candidates.append(BASE_DIR / filename)

    training_user = os.environ.get("LOG_A_PRIORI_TRAINING_USER_ID", "3m04j6ngn2ucr7u").strip()
    if training_user:
        candidates.append(BASE_DIR / training_user / filename)

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0] if candidates else BASE_DIR / filename

def resolve_project_dir(project_id, user_id = None):
    owner = (user_id or os.environ.get("PROJECT_OWNER_USER_ID", "")).strip()
    if owner:
        return BASE_DIR / owner / project_id
    return BASE_DIR / project_id

def progress_file_path(project_root):
    return Path(project_root) / DEFAULT_ANALYSIS_SUBDIR / PROGRESS_FILE_NAME

def write_embedding_progress(project_root, phase, message, *, current = 0, total = 0):
    project_root = Path(project_root)
    payload: Dict[str, Any] = {
        "phase": phase,
        "message": message,
        "current": int(current),
        "total": int(total),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    target = progress_file_path(project_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload), encoding="utf-8")
    print(f"KG_PROGRESS {json.dumps(payload)}", flush=True)

def clear_embedding_progress(project_root):
    target = progress_file_path(project_root)
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass

def read_embedding_progress(project_root):
    target = progress_file_path(project_root)
    if not target.is_file():
        return None
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

def count_embed_cache_files(project_root):
    cache_dir = Path(project_root) / EMBED_CACHE_DIR
    if not cache_dir.is_dir():
        return 0
    return sum(1 for entry in cache_dir.iterdir() if entry.suffix == ".npy")

def describe_embeddings_status(project_root):
    project_root = Path(project_root)
    json_path = find_graph_json(project_root)
    pkls = find_project_pickles(project_root)
    cache_count = count_embed_cache_files(project_root)
    return {
        "ready": bool(pkls),
        "hasGraphJson": json_path is not None,
        "hasPreprocessedGraph": bool(pkls),
        "hasEmbedCache": cache_count > 0,
        "embedCacheCount": cache_count,
        "progress": read_embedding_progress(project_root),
    }

def find_graph_json(project_root):
    project_root = Path(project_root)
    candidate = project_root / DEFAULT_ANALYSIS_SUBDIR / GRAPH_JSON_NAME
    if candidate.is_file():
        return candidate
    return None

def find_project_pickles(project_root):
    return sorted(Path(project_root).glob("preprocessed-graph-*.pkl"))

def project_has_graph_source(project_root):
    return bool(find_project_pickles(project_root)) or find_graph_json(project_root) is not None

def pkl_path_for_json(json_path, project_root):
    path_hash = hashlib.md5(str(json_path).encode()).hexdigest()[:12]
    return Path(project_root) / f"preprocessed-graph-{path_hash}.pkl"

def load_embed_model():
    global TOKENIZER, EMBED_MODEL
    if TOKENIZER is not None and EMBED_MODEL is not None:
        return TOKENIZER, EMBED_MODEL

    from transformers import AutoModel, AutoTokenizer

    TOKENIZER = AutoTokenizer.from_pretrained(MODEL_ID)
    EMBED_MODEL = AutoModel.from_pretrained(MODEL_ID)
    EMBED_MODEL.eval()
    if torch.cuda.is_available():
        EMBED_MODEL.cuda()
    return TOKENIZER, EMBED_MODEL

def embed_token_chunk(token_ids, attention_mask, model):
    input_ids = torch.tensor([token_ids], dtype=torch.long)
    attn_mask = torch.tensor([attention_mask], dtype=torch.long)
    if torch.cuda.is_available():
        input_ids = input_ids.cuda()
        attn_mask = attn_mask.cuda()
    with torch.no_grad():
        outputs = model(input_ids, attention_mask=attn_mask)

    masked = outputs.last_hidden_state * attn_mask.unsqueeze(-1)
    sum_emb = masked.sum(dim=1)
    real_count = attn_mask.sum(dim=1)
    return (sum_emb / real_count.unsqueeze(-1)).squeeze().cpu().numpy().astype(np.float32)

def get_code_embedding(code, tokenizer, model, display_flag=False, max_len=CODEBERT_MAX_LEN, overlap=CHUNK_OVERLAP):
    encoding = tokenizer(code, return_tensors="pt", truncation=False, padding=False)
    input_ids = encoding["input_ids"][0].tolist()
    total_tokens = len(input_ids)
    if display_flag:
        print(f"\tToken count: {total_tokens}")

    if total_tokens <= max_len:
        inputs = tokenizer(code, return_tensors="pt", truncation=True, max_length=max_len)
        if torch.cuda.is_available():
            inputs = {k: v.cuda() for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        return outputs.last_hidden_state.mean(dim=1).squeeze().cpu().numpy().astype(np.float32)

    chunk_embeddings = []
    stride = max_len - overlap
    for start in range(0, total_tokens, stride):
        end = min(start + max_len, total_tokens)
        chunk_ids = input_ids[start:end]
        attn_mask = [1] * len(chunk_ids)
        if len(chunk_ids) < max_len:
            pad_len = max_len - len(chunk_ids)
            chunk_ids.extend([tokenizer.pad_token_id] * pad_len)
            attn_mask.extend([0] * pad_len)
        chunk_embeddings.append(embed_token_chunk(chunk_ids, attn_mask, model))
    return np.mean(chunk_embeddings, axis=0)

def cache_embedding(node_id, code, tokenizer, model, project_root, display_flag=False):
    project_root = Path(project_root)
    safe_id = hashlib.md5(node_id.encode()).hexdigest()
    cache_dir = project_root / EMBED_CACHE_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{safe_id}.npy"
    if cache_path.exists():
        return np.load(cache_path)
    emb = get_code_embedding(code, tokenizer, model, display_flag=False)
    np.save(cache_path, emb)
    return emb

def embed_nodes_from_json(json_path, tokenizer, model, project_root, display_flag=False):
    import json as json_module

    project_root = Path(project_root)
    with open(json_path, "r", encoding="utf-8") as handle:
        data = json_module.load(handle)
    nodes = data["graph"]["nodes"]
    total = len(nodes)
    valid_nodes = []
    embeddings = []
    write_embedding_progress(project_root, "embedding", f"Embedding function nodes (0/{total})", current=0, total=total)
    for index, node in enumerate(nodes, start=1):
        code = node.get("code", "")
        emb = cache_embedding(node["id"], code, tokenizer, model, project_root, display_flag=display_flag)
        embeddings.append(emb)
        valid_nodes.append(node)
        if index == 1 or index == total or index % 5 == 0:
            write_embedding_progress(project_root, "embedding", f"Embedding function nodes ({index}/{total})", current=index, total=total)
    matrix = np.vstack(embeddings).astype(np.float32)
    return valid_nodes, matrix

def build_homogeneous_graph(edges, id_to_idx):
    edge_pairs = []
    for edge in edges:
        src = id_to_idx.get(edge["from"])
        dst = id_to_idx.get(edge["to"])
        if src is None or dst is None:
            continue
        edge_pairs.append([src, dst])
        edge_pairs.append([dst, src])
    if not edge_pairs:
        return torch.empty((2, 0), dtype=torch.long)
    return torch.tensor(edge_pairs, dtype=torch.long).t().contiguous()

def json_to_pyg_data(json_path, valid_nodes, embeddings):
    import json

    with open(json_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    edges = data["graph"]["edges"]
    id_to_idx = {node["id"]: i for i, node in enumerate(valid_nodes)}
    edge_index = build_homogeneous_graph(edges, id_to_idx)
    x = torch.tensor(embeddings, dtype=torch.float)
    return Data(x=x, edge_index=edge_index), valid_nodes

def preprocess_graph_from_json(json_path, project_root = None):
    json_path = Path(json_path)
    project_root = Path(project_root or json_path.parent.parent)
    out_file = pkl_path_for_json(json_path, project_root)

    write_embedding_progress(project_root, "loading_model", "Loading UniXcoder embedding model (first run may download weights)")
    tokenizer, model = load_embed_model()
    valid_nodes, emb_matrix = embed_nodes_from_json(json_path, tokenizer, model, project_root)
    write_embedding_progress(project_root, "building_graph", "Building preprocessed graph for inference")
    pyg_data, node_list = json_to_pyg_data(json_path, valid_nodes, emb_matrix)

    with open(out_file, "wb") as handle:
        pickle.dump(
            {
                "x": pyg_data.x.detach().cpu(),
                "edge_index": pyg_data.edge_index.detach().cpu(),
                "node_list": node_list,
                "json_path": json_path,
                "original_embeddings": emb_matrix,
            },
            handle,
            protocol=pickle.HIGHEST_PROTOCOL,
        )
    write_embedding_progress(
        project_root,
        "complete",
        "Embeddings and preprocessed graph are ready",
        current=1,
        total=1,
    )
    clear_embedding_progress(project_root)
    return out_file

def ensure_preprocessed_graph(project_root, *, refresh = False):
    project_root = Path(project_root)
    pkls = find_project_pickles(project_root)
    if pkls and not refresh:
        clear_embedding_progress(project_root)
        return pkls[0]

    json_path = find_graph_json(project_root)
    if json_path is None:
        clear_embedding_progress(project_root)
        raise FileNotFoundError(f"No preprocessed graph or {DEFAULT_ANALYSIS_SUBDIR}/{GRAPH_JSON_NAME} in {project_root}")

    expected = pkl_path_for_json(json_path, project_root)
    if expected.exists() and not refresh:
        clear_embedding_progress(project_root)
        return expected

    try:
        return preprocess_graph_from_json(json_path, project_root)
    except Exception:
        write_embedding_progress(project_root, "error", "Embedding preprocessing failed, check server logs")
        raise

def find_all_graph_jsons(appdata_base: Path) -> List[Path]:
    import glob

    pattern = os.path.join(str(appdata_base), "*", DEFAULT_ANALYSIS_SUBDIR, GRAPH_JSON_NAME)
    return [Path(p) for p in glob.glob(pattern)]

def main():
    parser = argparse.ArgumentParser(description="Build embeddings and preprocessed graph pickle for a project")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--user-id", default="")
    parser.add_argument("--status-only", action="store_true", help="Print embeddings status json and exit")
    parser.add_argument("--refresh", action="store_true", help="Rebuild pickle even if one exists")
    args = parser.parse_args()

    user_id = args.user_id.strip() or os.environ.get("PROJECT_OWNER_USER_ID", "").strip()
    if user_id:
        os.environ["PROJECT_OWNER_USER_ID"] = user_id

    project_dir = resolve_project_dir(args.project_id, user_id)
    if args.status_only:
        print(json.dumps(describe_embeddings_status(project_dir)))
        return

    pkl_path = ensure_preprocessed_graph(project_dir, refresh=args.refresh)
    status = describe_embeddings_status(project_dir)
    print(json.dumps({**status, "pklPath": str(pkl_path)}))

if __name__ == "__main__":
    main()
