import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModel
import numpy as np
import os
import json
import pickle
from pathlib import Path
from sklearn.metrics.pairwise import cosine_similarity
import random
from torch_geometric.data import Data
from train_unsupervised_dgi import load_graph_bundle

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"
MODEL_SAVE_PATH = BASE_DIR / "seed_projection.pt" # projection weights only
QUERIES_JSON = "nl_queries_inductive_train.json"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
LEARNING_RATE = 1e-4 # low lr for training only a linear layer
BATCH_SIZE = 32
EPOCHS = 30
TEMPERATURE = 0.07
WEIGHT_DECAY = 1e-5
PATIENCE = 5 # early stopping

def build_query_dataset(): # collecting (query_text, positive_node_embedding) pairs from all projects
    pairs = []  # list of (query_text, pos_emb_vector) tuples
    pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl"))
    for pkl_path in pkl_files:
        project_dir = pkl_path.parent
        queries_path = project_dir / QUERIES_JSON
        if not queries_path.exists():
            continue # skip projects without query annotations
        with open(queries_path, "r", encoding="utf-8") as f:
            queries = json.load(f)
        data, node_list, _ = load_graph_bundle(pkl_path)
        id_to_idx = {node["id"]: i for i, node in enumerate(node_list)}
        # data.x is the static UniXcoder embedding matrix (shape: N x 768)
        node_embs = data.x.numpy() # dim (N, 768)
        
        for query, node_id in queries.items(): # pair each query with its corresponding node's embedding
            if node_id in id_to_idx:
                idx = id_to_idx[node_id]
                pos_emb = node_embs[idx]
                pairs.append((query, pos_emb))
    print(f"Collected {len(pairs)} query–node pairs")
    return pairs

class QueryNodeDataset(Dataset):
    def __init__(self, pairs):
        self.pairs = pairs

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, idx):
        query, pos_emb = self.pairs[idx]
        return query, torch.tensor(pos_emb, dtype=torch.float32)

def collate_fn(batch): # extracting queries and stack embeddings
    queries = [item[0] for item in batch]
    pos_embs = torch.stack([item[1] for item in batch])
    return queries, pos_embs

class QueryProjection(nn.Module): # text-to-embedding projection head: frozen encoder + linear layer
    def __init__(self, model_name="microsoft/unixcoder-base", proj_dim=768, freeze_encoder=True):
        super().__init__()
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.encoder = AutoModel.from_pretrained(model_name)
        
        if freeze_encoder: # freeze encoder to prevent finetuning, only train projection head
            for param in self.encoder.parameters():
                param.requires_grad = False
        # projection head: mean pooling + linear transformation to proj_dim
        self.proj = nn.Linear(768, proj_dim)
        self.dropout = nn.Dropout(0.1)

    def forward(self, texts): # encoding texts and project to embedding space
        inputs = self.tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(DEVICE)
        with torch.no_grad():
            outputs = self.encoder(**inputs)
        # mean pooling over token sequence (weighted by attention mask)
        mask = inputs["attention_mask"].unsqueeze(-1).to(outputs.last_hidden_state.dtype)
        emb = (outputs.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1)
        emb = self.dropout(emb)
        return self.proj(emb)

def info_nce_loss(query_emb, pos_emb, temperature=TEMPERATURE): # contrastive loss with in batch negatives
    # query_emb: (batch, dim), projected query embeddings
    # pos_emb: (batch, dim), static node embeddings (targets)
    
    query_emb = F.normalize(query_emb, p=2, dim=-1)
    pos_emb = F.normalize(pos_emb, p=2, dim=-1)
    logits = torch.matmul(query_emb, pos_emb.T) / temperature
    
    targets = torch.arange(len(query_emb), device=query_emb.device) # targets: query i should match node i (assumes batch ordering is aligned)
    loss = F.cross_entropy(logits, targets) # cross entropy loss with in batch negatives
    return loss

def evaluate_projection(model, val_loader, device): # compute top 1 retrieval accuracy on validation set
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for queries, pos_embs in val_loader:
            q_emb = model(queries) # project queries to embedding space
            q_emb = F.normalize(q_emb, p=2, dim=-1) # normalize for cosine similarity
            pos_embs = pos_embs.to(device)
            pos_embs_norm = F.normalize(pos_embs, p=2, dim=-1)
            # compute similarity between queries and all positives in batch
            sim = torch.matmul(q_emb, pos_embs_norm.T)

            preds = sim.argmax(dim=1) # the highest similarity match
            
            correct += (preds == torch.arange(len(queries), device=device)).sum().item() # prediction matches ground truth
            total += len(queries)

    acc = correct / total
    return acc

if __name__ == "__main__":
    pairs = build_query_dataset()
    if len(pairs) == 0:
        print("No query-node pairs found, run generate_queries.py first")
        
    random.shuffle(pairs)
    split = int(0.8 * len(pairs))
    train_pairs = pairs[:split]
    val_pairs = pairs[split:]

    train_dataset = QueryNodeDataset(train_pairs)
    val_dataset = QueryNodeDataset(val_pairs)
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    model = QueryProjection(proj_dim=768, freeze_encoder=True).to(DEVICE)   # keep 768 dim to match node embeddings
    optimizer = torch.optim.Adam(model.proj.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=PATIENCE, factor=0.5)

    best_val_acc = 0.0
    patience_counter = 0

    print(f"Training seed retrieval projection on {len(train_pairs)} pairs...")
    for epoch in range(1, EPOCHS+1):
        model.train()
        total_loss = 0.0
        for queries, pos_embs in train_loader:
            pos_embs = pos_embs.to(DEVICE)
            q_emb = model(queries)
            loss = info_nce_loss(q_emb, pos_embs)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(queries)

        avg_loss = total_loss / len(train_pairs)
        val_acc = evaluate_projection(model, val_loader, DEVICE)
        scheduler.step(val_acc) # reduce lr on plateau of validation accuracy

        print(f"\tepoch {epoch:03d}, loss: {avg_loss:.4f}, val top 1 acc: {val_acc:.4f}")

        if val_acc > best_val_acc: # early stopping and checkpoint
            best_val_acc = val_acc
            torch.save(model.proj.state_dict(), MODEL_SAVE_PATH)
            print(f"  -> new best model saved (acc={best_val_acc:.4f})")
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"Early stopping after {epoch} epochs")
                break

    print(f"\nTraining complete, best validation top 1 accuracy: {best_val_acc:.4f}")
    print(f"Projection weights saved to {MODEL_SAVE_PATH}")