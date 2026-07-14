import torch
import numpy as np
import os
from pathlib import Path
from sklearn.metrics.pairwise import cosine_similarity
from train_unsupervised_dgi import load_graph_bundle, MultiGraphEncoder
from tabulate import tabulate
import matplotlib.pyplot as plt
from eval_plot_utils import sort_rows_by_project, style_project_xaxis, project_ids_from_rows

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"
UNSUPERVISED_ENCODER_PATH = BASE_DIR / "unsupervised_inductive_dgi_encoder.pt"
FINETUNED_ENCODER_PATH = BASE_DIR / "finetuned_inductive_dgi_encoder.pt"
PROJECTION_HEAD_PATH = BASE_DIR / "node_projection_head.pt"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

K_FIXED = 20

METHODS = [
    ("raw", "unixcoder"),
    ("dgi_unsupervised", "dgi nesupervizat"),
    ("dgi_finetuned", "dgi finetuned"),
]

METRICS = [
    ("precision", "precision"),
    ("recall", "recall"),
    ("f1", "f1"),
]

METHOD_COLORS = {
    "raw": "#7c3aed",
    "dgi_unsupervised": "#2563eb",
    "dgi_finetuned": "#0f766e",
}

def build_encoder(ckpt, in_channels):
    hidden_channels = int(ckpt["mp1.lin.weight"].shape[0])
    out_channels = int(ckpt["mp3.lin.weight"].shape[0])
    use_batch_norm = any(".bn." in key for key in ckpt.keys())
    encoder = MultiGraphEncoder(
        in_channels,
        hidden_channels,
        out_channels,
        use_input_proj=True,
        use_batch_norm=use_batch_norm,
    ).to(DEVICE)
    encoder.load_state_dict(ckpt)
    encoder.eval()
    return encoder, out_channels

def load_projection_head(out_channels):
    if not PROJECTION_HEAD_PATH.exists():
        return None
    try:
        from train_finetuned_dgi import ProjectionHead
        projection_state = torch.load(PROJECTION_HEAD_PATH, map_location=DEVICE)
        projection_hidden_dim = int(projection_state["net.0.weight"].shape[0])
        projection_head = ProjectionHead(out_channels, projection_hidden_dim, out_channels).to(DEVICE)
        projection_head.load_state_dict(projection_state)
        projection_head.eval()
        return projection_head
    except Exception as exc:
        print(f"[DGI] Projection head skipped: {exc}")
        return None

@torch.no_grad()
def encode_graph(data, encoder, projection_head=None):
    node_embs = encoder(data.x.to(DEVICE), data.edge_index.to(DEVICE))
    if projection_head is not None:
        node_embs = projection_head(node_embs)
    return node_embs.cpu().numpy()

def format_summary_table(rows):
    if not rows:
        return "No rows to summarize"

    summary_rows = []
    for method_key, method_label in METHODS:
        row = [method_label]
        for metric_key, _metric_label in METRICS:
            values = np.asarray([entry[f"{method_key}_{metric_key}"] for entry in rows], dtype=float)
            row.append(f"{values.mean():.3f}")
        summary_rows.append(row)

    headers = ["metoda", *[metric_label for _, metric_label in METRICS]]
    return tabulate(summary_rows, headers=headers, tablefmt="github", stralign="right", numalign="right")

def make_plot(rows, out_dir):
    rows = sort_rows_by_project(rows)
    if not rows:
        return

    metric_specs = [
        ("precision", "Precision", False),
        ("recall", "Recall", False),
        ("f1", "F1", False),
    ]

    x = np.arange(len(rows))
    projects = project_ids_from_rows(rows)

    fig, axes = plt.subplots(1, len(metric_specs), figsize=(22, 7), constrained_layout=True)
    if len(metric_specs) == 1:
        axes = [axes]

    for ax, (metric_key, title, invert_axis) in zip(axes, metric_specs):
        for method_key, label, _color in [(m[0], m[1], METHOD_COLORS[m[0]]) for m in METHODS]:
            y = np.asarray([row[f"{method_key}_{metric_key}"] for row in rows], dtype=float)
            if np.all(np.isnan(y)):
                continue
            ax.plot(
                x,
                y,
                label=label,
                color=METHOD_COLORS[method_key],
                linewidth=2.0,
                marker="o",
                markersize=4,
                alpha=0.9,
            )

        style_project_xaxis(ax, projects)
        ax.set_title(title)
        ax.set_ylabel(title)
        ax.grid(True, axis="y", alpha=0.2)
        if invert_axis:
            ax.invert_yaxis()
        ax.legend(loc="best")

    fig.suptitle("Intrinsic retrieval comparison across projects", fontsize=14, fontweight="bold")
    fig.savefig(out_dir / "intrinsic_retrieval_connected_dots.png", dpi=180)
    plt.close(fig)

def cluster_retrieval_1hop(embeddings, edge_index, fixed_k=20):
    N = embeddings.shape[0]
    sim = cosine_similarity(embeddings)
    np.fill_diagonal(sim, -np.inf)

    true_neigh = {i: set() for i in range(N)}
    for src, dst in edge_index.t().tolist():
        true_neigh[src].add(dst)
        true_neigh[dst].add(src)

    precisions, recalls, f1s = [], [], []
    for i in range(N):
        true_set = true_neigh[i]
        if not true_set:
            continue

        deg = len(true_set)
        k = fixed_k
        if k >= N:
            topk = np.argsort(-sim[i])[:k]
        else:
            topk = np.argpartition(-sim[i], k)[:k]
        retrieved_set = set(topk)

        inter = len(retrieved_set & true_set)
        prec = inter / len(retrieved_set) if retrieved_set else 0.0
        rec = inter / deg
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0

        precisions.append(prec)
        recalls.append(rec)
        f1s.append(f1)

    return np.mean(precisions), np.mean(recalls), np.mean(f1s)

if not UNSUPERVISED_ENCODER_PATH.exists():
    raise FileNotFoundError(f"Model not found at {UNSUPERVISED_ENCODER_PATH}, run train_unsupervised_dgi.py first.")
if not FINETUNED_ENCODER_PATH.exists():
    raise FileNotFoundError(f"Model not found at {FINETUNED_ENCODER_PATH}, run train_finetuned_dgi.py first.")

unsupervised_ckpt = torch.load(UNSUPERVISED_ENCODER_PATH, map_location=DEVICE)
finetuned_ckpt = torch.load(FINETUNED_ENCODER_PATH, map_location=DEVICE)

pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl"))
print(f"Found {len(pkl_files)} preprocessed graph pickles:")
if len(pkl_files) == 0:
    raise FileNotFoundError("No preprocessed graphs found, run preprocess_graphs.py first")

rows = []

for pkl_path in pkl_files:
    data, node_list, _ = load_graph_bundle(pkl_path)

    raw_emb = data.x.cpu().numpy()
    edge_index_undir = data.edge_index[:, data.edge_index[0] < data.edge_index[1]]

    in_ch = data.num_features
    unsupervised_encoder, _ = build_encoder(unsupervised_ckpt, in_ch)
    finetuned_encoder, ft_out_channels = build_encoder(finetuned_ckpt, in_ch)
    projection_head = load_projection_head(ft_out_channels)

    unsupervised_emb = encode_graph(data, unsupervised_encoder)
    finetuned_emb = encode_graph(data, finetuned_encoder, projection_head)

    p_raw, r_raw, f1_raw = cluster_retrieval_1hop(raw_emb, edge_index_undir, fixed_k=K_FIXED)
    p_uns, r_uns, f1_uns = cluster_retrieval_1hop(unsupervised_emb, edge_index_undir, fixed_k=K_FIXED)
    p_ft, r_ft, f1_ft = cluster_retrieval_1hop(finetuned_emb, edge_index_undir, fixed_k=K_FIXED)

    project_id = pkl_path.parent.name if pkl_path.parent != BASE_DIR else pkl_path.stem
    rows.append({
        "project_id": project_id,
        "raw_precision": p_raw,
        "raw_recall": r_raw,
        "raw_f1": f1_raw,
        "dgi_unsupervised_precision": p_uns,
        "dgi_unsupervised_recall": r_uns,
        "dgi_unsupervised_f1": f1_uns,
        "dgi_finetuned_precision": p_ft,
        "dgi_finetuned_recall": r_ft,
        "dgi_finetuned_f1": f1_ft,
    })

per_project_headers = ["project id"]
for metric_key, metric_label in METRICS:
    for _method_key, method_label in METHODS:
        per_project_headers.append(f"{method_label} {metric_label}")

table = []
for row in sort_rows_by_project(rows):
    table_row = [row["project_id"]]
    for metric_key, _metric_label in METRICS:
        for method_key, _method_label in METHODS:
            table_row.append(f"{row[f'{method_key}_{metric_key}']:.4f}")
    table.append(table_row)

print(tabulate(
    table,
    headers=per_project_headers,
    tablefmt="github",
    stralign="right",
    numalign="right",
))

print("\nMean across projects:")
print(format_summary_table(rows))

make_plot(rows, BASE_DIR)
print(f"\nPlot: {BASE_DIR / 'intrinsic_retrieval_connected_dots.png'}")
