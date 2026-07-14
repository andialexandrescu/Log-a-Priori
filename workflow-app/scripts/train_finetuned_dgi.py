import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
import os
import json
import pickle
import sys
from pathlib import Path
from tqdm import tqdm
import random
from collections import defaultdict
from train_unsupervised_dgi import load_graph_bundle, MultiGraphEncoder
from train_query_projection import QueryProjection

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"
# these paths keep the finetuned encoder, query projection, and fallback unsupervised weights aligned in one workspace
PROJECTION_PATH = BASE_DIR / "seed_projection.pt" # pretrained query projection model
FINETUNED_DGI_PATH = BASE_DIR / "finetuned_inductive_dgi_encoder.pt"
QUERIES_JSON = "nl_queries_inductive_train.json"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
HIDDEN_CHANNELS = 256 # reduced from 512 to prevent overfitting with limited data (1717 pairs)
OUT_CHANNELS = 768 # must match projection output dimension

# conservative settings for a small multi project query-node dataset
LEARNING_RATE = 2e-5
BATCH_SIZE = 32
EPOCHS = 180
TEMPERATURE = 0.15
WEIGHT_DECAY = 1e-3
SCHEDULER_PATIENCE = 4
EARLY_STOP_PATIENCE = 14
EARLY_STOP_MIN_DELTA = 5e-3

# node projection head: maps encoder output into the shared query space
PROJ_HEAD_DIM = 48
PROJ_HEAD_DROPOUT = 0.25

# train/ val split and graph regularization
VALIDATION_SPLIT = 0.40
RANDOM_SEED = 42
EDGE_DROP_RATE = 0.15

# graph local query loss: each query must rank its node above others in the same graph
GRAPH_LOCAL_QUERY_WEIGHT = 0.03

class QueryNodeFineTuneDataset(Dataset): # this dataset loads query-node ground truth pairs from multiple projects
    def __init__(self, base_dir=BASE_DIR, split='train', validation_split=VALIDATION_SPLIT, random_seed=RANDOM_SEED):
        # the split happens at the project level so validation never sees the same graph structure as training
        self.pairs = []  # list of (pkl_path, node_id, query_text) tuples
        pkl_files = list(base_dir.glob("*/preprocessed-graph-*.pkl"))
        
        projects = defaultdict(list)
        for pkl_path in pkl_files:
            proj_dir = pkl_path.parent
            projects[proj_dir].append(pkl_path)
        
        rng = random.Random(random_seed)
        project_dirs = list(projects.keys())
        rng.shuffle(project_dirs)
        # the validation slice is a fixed fraction of projects, not a random slice of individual queries
        val_project_count = max(1, int(len(project_dirs) * validation_split))
        val_project_dirs = set(project_dirs[:val_project_count])
        
        for pkl_path in pkl_files:
            proj_dir = pkl_path.parent
            
            is_val_project = proj_dir in val_project_dirs
            if (split == 'val' and not is_val_project) or (split == 'train' and is_val_project):
                continue
            
            queries_path = proj_dir / QUERIES_JSON
            if not queries_path.exists():
                continue
            with open(queries_path, "r", encoding="utf-8") as f:
                queries = json.load(f)

            data, node_list, _ = load_graph_bundle(pkl_path) # load graph structure to map node ids to indices
            id_to_idx = {node["id"]: i for i, node in enumerate(node_list)}
            for query_text, node_id in queries.items():
                if node_id in id_to_idx:
                    # only keep query-node pairs that still exist in the loaded graph snapshot
                    self.pairs.append((pkl_path, node_id, query_text))
        
        split_name = "validation" if split == 'val' else "training"
        print(f"Loaded {split_name} set: {len(self.pairs)} query-node pairs from {len([d for d in project_dirs if (d in val_project_dirs) == (split == 'val')])} projects")

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, idx):
        pkl_path, node_id, query = self.pairs[idx]
        return pkl_path, node_id, query

class ProjectionHead(nn.Module):
    def __init__(self, in_dim, hidden_dim, out_dim, dropout=0.1):
        super().__init__()
        # a shallow projection head gives the node encoder some flexibility without adding too much capacity
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, out_dim)
        )

    def forward(self, x):
        return self.net(x)

def collate_fn(batch): # group batch items by pickle file path to process graphs together and minimize useless graph loads during training
    # batching by project file keeps repeated graph loads out of the inner training loop
    grouped = defaultdict(lambda: {"queries": [], "node_ids": []})
    for pkl_path, node_id, query in batch:
        grouped[pkl_path]["queries"].append(query)
        grouped[pkl_path]["node_ids"].append(node_id)
    items = []
    for pkl_path, data in grouped.items():
        items.append((pkl_path, data["queries"], data["node_ids"])) # return list of (pkl_path, [queries], [node_ids]) grouped by file
    return items

def augment_graph(edge_index, drop_rate=0.15):
    # edge dropping is the only structural augmentation used here, and it only applies during training
    num_edges = edge_index.shape[1]
    num_to_drop = max(1, int(num_edges * drop_rate))
    drop_mask = torch.randperm(num_edges)[:num_to_drop]
    keep_mask = torch.ones(num_edges, dtype=torch.bool, device=edge_index.device)
    keep_mask[drop_mask] = False
    augmented_edge_index = edge_index[:, keep_mask]
    return augmented_edge_index

def load_projection():
    model = QueryProjection(proj_dim=OUT_CHANNELS, freeze_encoder=False).to(DEVICE)
    model.proj.load_state_dict(torch.load(PROJECTION_PATH, map_location=DEVICE))
    model.train()
    print(f"Query projection loaded (unfrozen), output dimension = {OUT_CHANNELS}")
    return model

def load_dgi_encoder(in_channels, hidden_channels, out_channels):
    # unsupervised pretraining is intentionally not reused here, training from scratch
    encoder = MultiGraphEncoder(in_channels, hidden_channels, out_channels, use_input_proj=True).to(DEVICE)
    print("Initialising DGI encoder randomly")
    return encoder

@torch.no_grad()
def validate(encoder, node_projection, val_loader, projection, criterion): # computing validation loss: batch contrastive + graph local query loss
    encoder.eval()
    node_projection.eval()
    projection_was_training = projection.training
    projection.eval()

    total_loss = 0.0
    total_contrastive = 0.0
    total_graph_local = 0.0
    num_pairs = 0
    total_hits = 0
    total_queries = 0
    project_hits = defaultdict(lambda: {"hits": 0, "queries": 0})

    with torch.no_grad():
        for batch_items in tqdm(val_loader, desc="Validating"):
            all_q_emb = []
            all_pos_emb = []
            all_graph_node_embs = []
            all_pos_indices = []
            all_project_keys = []

            for pkl_path, queries, node_ids in batch_items:
                data, node_list, _ = load_graph_bundle(pkl_path)
                id_to_idx = {node["id"]: i for i, node in enumerate(node_list)}
                pos_indices = [id_to_idx[nid] for nid in node_ids if nid in id_to_idx]
                if len(pos_indices) != len(node_ids):
                    continue

                x = data.x.to(DEVICE)
                edge_index = data.edge_index.to(DEVICE)
                node_embs = node_projection(encoder(x, edge_index))
                pos_embs = node_embs[pos_indices]
                q_embs = projection(queries)

                all_q_emb.append(q_embs)
                all_pos_emb.append(pos_embs)
                all_graph_node_embs.append(node_embs)
                all_pos_indices.append(pos_indices)
                all_project_keys.append(str(pkl_path.parent))

            if not all_q_emb:
                continue

            q_emb = torch.cat(all_q_emb, dim=0)
            pos_emb = torch.cat(all_pos_emb, dim=0)

            for g_q, g_nodes, g_pos_idx, project_key in zip(all_q_emb, all_graph_node_embs, all_pos_indices, all_project_keys):
                qn = F.normalize(g_q, p=2, dim=-1)
                nn = F.normalize(g_nodes, p=2, dim=-1)
                sims = torch.matmul(qn, nn.T)
                top_idx = sims.argmax(dim=1).cpu()
                for i, p_idx in enumerate(g_pos_idx):
                    if top_idx[i].item() == p_idx:
                        total_hits += 1
                        project_hits[project_key]["hits"] += 1
                    total_queries += 1
                    project_hits[project_key]["queries"] += 1

            loss = criterion(q_emb, pos_emb)
            total_contrastive += loss.item() * len(q_emb)

            graph_local_loss = 0.0
            graph_local_count = 0
            for g_q, g_nodes, g_pos_idx in zip(all_q_emb, all_graph_node_embs, all_pos_indices):
                graph_local_loss += graph_local_query_loss(g_q, g_nodes, g_pos_idx, temperature=TEMPERATURE)
                graph_local_count += 1

            if graph_local_count > 0:
                graph_local_loss = graph_local_loss / graph_local_count
                loss = loss + GRAPH_LOCAL_QUERY_WEIGHT * graph_local_loss
                total_graph_local += graph_local_loss.item() * len(q_emb)

            total_loss += loss.item() * len(q_emb)
            num_pairs += len(q_emb)

    encoder.train()
    node_projection.train()
    if projection_was_training:
        projection.train()

    avg_val_loss = total_loss / num_pairs if num_pairs > 0 else 0.0
    avg_contrastive = total_contrastive / num_pairs if num_pairs > 0 else 0.0
    avg_graph_local = total_graph_local / num_pairs if num_pairs > 0 else 0.0
    hits_at_1 = (total_hits / total_queries) if total_queries > 0 else 0.0

    component_losses = {
        "contrastive": avg_contrastive,
        "graph_local": avg_graph_local,
        "hits@1": hits_at_1,
        "project_hits": {
            project: (stats["hits"] / stats["queries"] if stats["queries"] > 0 else 0.0)
            for project, stats in project_hits.items()
        },
    }

    return avg_val_loss, component_losses

class ContrastiveLoss(nn.Module):
    def __init__(self, temperature=0.1, label_smoothing=0.1):
        super().__init__()
        self.temperature = temperature # not a learnable parameter to prevent collapse
        self.label_smoothing = label_smoothing

    def forward(self, q_emb, pos_emb):
        # normalize both sides so the loss measures angular similarity instead of raw scale
        q_emb = F.normalize(q_emb, p=2, dim=-1)
        pos_emb = F.normalize(pos_emb, p=2, dim=-1)
        logits = torch.matmul(q_emb, pos_emb.T) / self.temperature # use fixed temperature
        targets = torch.arange(len(q_emb), device=q_emb.device)
        loss = F.cross_entropy(logits, targets, label_smoothing=self.label_smoothing)
        return loss

def graph_local_query_loss(q_embs, node_embs, pos_indices, temperature=TEMPERATURE): # query supervised retrieval loss within a single graph
    # each query must rank its aligned node above every other node in the same graph
    # this loss is local to one graph, which helps the model respect graph specific structure
    q_embs = F.normalize(q_embs, p=2, dim=-1)
    node_embs = F.normalize(node_embs, p=2, dim=-1)
    logits = torch.matmul(q_embs, node_embs.T) / temperature
    targets = torch.tensor(pos_indices, device=q_embs.device, dtype=torch.long)
    return F.cross_entropy(logits, targets)

def module_grad_norm(module):
    total = 0.0
    for param in module.parameters():
        if param.grad is not None:
            grad_norm = param.grad.detach().norm(2).item()
            total += grad_norm * grad_norm
    return total ** 0.5

if __name__ == "__main__":
    train_dataset = QueryNodeFineTuneDataset(split='train', validation_split=VALIDATION_SPLIT, random_seed=RANDOM_SEED)
    val_dataset = QueryNodeFineTuneDataset(split='val', validation_split=VALIDATION_SPLIT, random_seed=RANDOM_SEED)
    if len(train_dataset) == 0:
        print("No query-node pairs found, run generate_queries_for_project first")
        sys.exit(1)

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)
    sample_pkl = train_dataset.pairs[0][0]
    sample_data, _, _ = load_graph_bundle(sample_pkl)
    in_channels = sample_data.num_features # determining input dimension from a sample graph, 768 from pre trained embeddings

    projection = load_projection()
    encoder = load_dgi_encoder(in_channels, HIDDEN_CHANNELS, OUT_CHANNELS)
    node_projection = ProjectionHead(OUT_CHANNELS, PROJ_HEAD_DIM, OUT_CHANNELS, dropout=PROJ_HEAD_DROPOUT).to(DEVICE)
    parameters = (
        list(encoder.parameters())
        + list(node_projection.parameters())
        + list(projection.parameters())
    )

    criterion = ContrastiveLoss(temperature=TEMPERATURE, label_smoothing=0.1)
    optimizer_param_groups = [
        {"params": parameters, "lr": LEARNING_RATE, "weight_decay": WEIGHT_DECAY},
    ] # encoder/heads/projection (if unfrozen), temperature is now fixed (not learnable)
    optimizer = torch.optim.Adam(optimizer_param_groups)
    # reducing lr quickly when val loss stalls, then stop if no meaningful improvement
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=SCHEDULER_PATIENCE, min_lr=1e-7)

    best_val_loss = float('inf')
    patience_counter = 0
    print("Starting contrastive finetuning of DGI encoder (from scratch)...")
    print(f"Training set: {len(train_dataset)} pairs, Validation set: {len(val_dataset)} pairs")
    for epoch in range(1, EPOCHS + 1):
        encoder.train()
        node_projection.train()
        projection.train()
        total_loss = 0.0
        num_pairs = 0
        projection_grad_norm_total = 0.0
        projection_grad_norm_steps = 0

        for batch_items in tqdm(train_loader, desc=f"Epoch {epoch}"):
            all_q_emb = []
            all_pos_emb = []
            all_graph_node_embs = []
            all_pos_indices = []

            for pkl_path, queries, node_ids in batch_items:
                data, node_list, _ = load_graph_bundle(pkl_path)
                id_to_idx = {node["id"]: i for i, node in enumerate(node_list)}
                pos_indices = [id_to_idx[nid] for nid in node_ids if nid in id_to_idx]
                if len(pos_indices) != len(node_ids):
                    continue
                x = data.x.to(DEVICE)
                edge_index = data.edge_index.to(DEVICE)

                # GraphCL style edge dropping on half the training steps
                if torch.rand(1).item() > 0.5:
                    edge_index = augment_graph(edge_index, drop_rate=EDGE_DROP_RATE)

                node_embs = node_projection(encoder(x, edge_index))
                pos_embs = node_embs[pos_indices]
                q_embs = projection(queries)

                all_q_emb.append(q_embs)
                all_pos_emb.append(pos_embs)
                all_graph_node_embs.append(node_embs)
                all_pos_indices.append(pos_indices)

            if not all_q_emb:
                continue

            q_emb = torch.cat(all_q_emb, dim=0)
            pos_emb = torch.cat(all_pos_emb, dim=0)

            loss = criterion(q_emb, pos_emb)

            graph_local_loss = 0.0
            graph_local_count = 0
            for g_q, g_nodes, g_pos_idx in zip(all_q_emb, all_graph_node_embs, all_pos_indices):
                graph_local_loss += graph_local_query_loss(g_q, g_nodes, g_pos_idx, temperature=TEMPERATURE)
                graph_local_count += 1

            if graph_local_count > 0:
                graph_local_loss = graph_local_loss / graph_local_count
                loss = loss + GRAPH_LOCAL_QUERY_WEIGHT * graph_local_loss

            optimizer.zero_grad()
            loss.backward()
            projection_grad_norm_total += module_grad_norm(projection)
            projection_grad_norm_steps += 1
            torch.nn.utils.clip_grad_norm_(parameters, max_norm=1.0)
            optimizer.step()

            total_loss += loss.item() * len(q_emb)
            num_pairs += len(q_emb)

        avg_train_loss = total_loss / num_pairs if num_pairs > 0 else 0
        avg_projection_grad_norm = (projection_grad_norm_total / projection_grad_norm_steps if projection_grad_norm_steps > 0 else 0.0)

        avg_val_loss, val_components = validate(encoder, node_projection, val_loader, projection, criterion)
        
        # validation loss for learning rate scheduling and early stopping
        # reduce-on-plateau keeps the later epochs from overfitting too aggressively
        scheduler.step(avg_val_loss)
        
        component_str = f"contrastive={val_components['contrastive']:.4f}"
        if val_components.get("graph_local", 0) > 0:
            component_str += f", graph_local={val_components['graph_local']:.4f}"
        if "hits@1" in val_components:
            component_str += f", hits@1={val_components['hits@1']:.3f}"
        print(f"\tepoch {epoch:03d}, train_loss: {avg_train_loss:.4f}, val_loss: {avg_val_loss:.4f} [{component_str}], temp: {criterion.temperature:.3f}, lr: {optimizer.param_groups[0]['lr']:.2e}, proj_grad_norm: {avg_projection_grad_norm:.4f}")

        if 'project_hits' in val_components and val_components['project_hits']:
            per_project = ", ".join(
                f"{Path(project).name}={acc:.3f}"
                for project, acc in sorted(val_components['project_hits'].items(), key=lambda item: item[0])
            )
            print(f"\tval_hits@1_by_project: {per_project}")

        # save only when the validation gain is real enough to matter
        if avg_val_loss < (best_val_loss - EARLY_STOP_MIN_DELTA):
            best_val_loss = avg_val_loss
            torch.save(encoder.state_dict(), FINETUNED_DGI_PATH)
            torch.save(node_projection.state_dict(), BASE_DIR / "node_projection_head.pt")
            print(f"  -> new best model saved (val_loss={best_val_loss:.4f})")
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= EARLY_STOP_PATIENCE:
                print(f"Early stopping after {epoch} epochs (patience counter reached)")
                break

    print(f"\nFinetuning complete, best validation loss: {best_val_loss:.4f}")
    print(f"Finetuned DGI encoder saved to {FINETUNED_DGI_PATH}")