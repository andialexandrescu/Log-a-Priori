import torch
import numpy as np
import os
from pathlib import Path
from sklearn.metrics.pairwise import cosine_similarity
from train_dgi_v1 import load_graph_bundle
from train_dgi_v1 import GCNEncoder

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell"
MODEL_SAVE_PATH = BASE_DIR / "dgi_encoder_universal.pt"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

K_FIXED = 20

def cluster_retrieval_1hop(embeddings, edge_index, fixed_k=20): # metrics based on each node's top k nearest neighbours in embedding space and comparing with the actual 1 hop neighbourhood in the graph
    N = embeddings.shape[0]
    sim = cosine_similarity(embeddings)
    np.fill_diagonal(sim, -np.inf)

    true_neigh = {i: set() for i in range(N)}
    for src, dst in edge_index.t().tolist():
        true_neigh[src].add(dst)
        true_neigh[dst].add(src)

    precisions = []
    recalls = []
    f1s = []
    for i in range(N):
        true_set = true_neigh[i]
        if not true_set:
            continue # skipping isolated nodes

        deg = len(true_set)
        k = fixed_k
        if k >= N: # not enough nodes, take all except self
            topk = np.argsort(-sim[i])[:k]
        else:
            topk = np.argpartition(-sim[i], k)[:k] # indexes of the most similar k vectors
        retrieved_set = set(topk)

        inter = len(retrieved_set & true_set) # the number of nodes from topk[i] part of the true_neigh[i] set
        prec = inter / len(retrieved_set) if retrieved_set else 0.0
        rec = inter / deg
        f1 = 2*prec*rec/(prec+rec) if (prec+rec) > 0 else 0.0

        precisions.append(prec)
        recalls.append(rec)
        f1s.append(f1)

    return np.mean(precisions), np.mean(recalls), np.mean(f1s)

if not MODEL_SAVE_PATH.exists():
    raise FileNotFoundError(f"Model not found at {MODEL_SAVE_PATH}, run train_dgi.py first.")

ckpt = torch.load(MODEL_SAVE_PATH, map_location=DEVICE)
hidden_channels = ckpt['conv1.lin.weight'].shape[0]
out_channels = ckpt['conv2.lin.weight'].shape[0]

# finding all preprocessed pickle files inside project folders
pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl")) # one folder level down
print(f"Found {len(pkl_files)} preprocessed graph pickles:")
if len(pkl_files) == 0:
    raise FileNotFoundError("No preprocessed graphs found, run preprocess-graphs.py first")

print(f"{'Project id':<20s} {'UniXcoder precision':<20s} {'DGI precision':<20s} {'UniXcoder recall':<20s} {'DGI recall':<20s} {'UniXcoder f1':<20s} {'DGI f1':<20s}")

for pkl_path in pkl_files:
    data, node_list, _ = load_graph_bundle(pkl_path)

    raw_emb = data.x.cpu().numpy()
    edge_index_undir = data.edge_index[:, data.edge_index[0] < data.edge_index[1]]

    in_ch = data.num_features
    encoder = GCNEncoder(in_ch, hidden_channels, out_channels).to(DEVICE) # the learned embeddings
    encoder.load_state_dict(ckpt)
    encoder.eval()
    with torch.no_grad():
        dgi_emb = encoder(data.x.to(DEVICE), data.edge_index.to(DEVICE)).cpu().numpy()

    p_raw, r_raw, f1_raw = cluster_retrieval_1hop(raw_emb, edge_index_undir, fixed_k=20)
    p_dgi, r_dgi, f1_dgi = cluster_retrieval_1hop(dgi_emb, edge_index_undir, fixed_k=20)

    project_id = pkl_path.parent.name if pkl_path.parent != BASE_DIR else pkl_path.stem
    print(f"{project_id:<20s} {p_raw:<20f} {p_dgi:<20f} {r_raw:<20f} {r_dgi:<20f} {f1_raw:<20f} {f1_dgi:<20f}")