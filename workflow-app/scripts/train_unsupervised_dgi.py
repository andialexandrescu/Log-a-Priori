import torch
import os
import numpy as np
from pathlib import Path
import pickle
import sys
from torch_geometric.data import Data, Batch
from torch_geometric.loader import DataLoader
from torch_geometric.utils import degree, scatter, dropout_edge
import torch.nn as nn
import torch.nn.functional as F

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u"
MODEL_SAVE_PATH = BASE_DIR / "unsupervised_inductive_dgi_encoder.pt"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
HIDDEN_CHANNELS = 512
OUT_CHANNELS = 512

EPOCHS = 100
BATCH_SIZE = 2 # number of graphs per batch
LR = 1e-3
DROP_PROB = 0.2 # dropout on input features for corruption
EDGE_DROP_PROB = 0.1 # edge dropout probability
SCHEDULER_PATIENCE = 5
SCHEDULER_FACTOR = 0.5
WEIGHT_DECAY = 1e-5
USE_BATCH_NORM = True 

def load_graph_bundle(pkl_path):
    with open(pkl_path, "rb") as f:
        bundle = pickle.load(f)

    # for older bundles that stored `Data` under the `data` key
    if "data" in bundle:
        data = bundle["data"]
        node_list = bundle.get("node_list", [])
        original = bundle.get("original_embeddings")
        if original is None and hasattr(data, "x"):
            try:
                original = data.x.detach().cpu().numpy()
            except Exception:
                original = None
        return data, node_list, original

    x = bundle["x"]
    edge_index = bundle["edge_index"]
    data = Data(x=x, edge_index=edge_index)
    node_list = bundle.get("node_list", [])
    original = bundle.get("original_embeddings")
    if original is None:
        try:
            original = x.detach().cpu().numpy()
        except Exception:
            original = None
    return data, node_list, original

# this MeanPool layer is used three times with skip connections and LeakyReLU activations to build the full graph encoder
class MeanPool(nn.Module): # mean pooling propagation rule used in GraphSAGE
    def __init__(self, in_channels, out_channels, use_batch_norm=False):
        super().__init__()
        self.lin = nn.Linear(in_channels, out_channels)
        self.use_batch_norm = use_batch_norm
        if use_batch_norm:
            self.bn = nn.BatchNorm1d(out_channels) # normalizes activations
        self.dropout = nn.Dropout(0.1) # prevents overfitting

    def forward(self, x, edge_index):
        row, col = edge_index
        deg = degree(row, x.size(0), dtype=x.dtype)
        deg_inv = deg.pow(-1)
        deg_inv[deg_inv == float('inf')] = 0 # isolated nodes
        edge_weight = deg_inv[col] # for each edge the weight = 1 / deg(target) where the target is col
        
        neighbor_mean = scatter(x[row] * edge_weight.unsqueeze(-1), col, dim=0, reduce='sum', dim_size=x.size(0)) # aggregating neighbour features (mean)
        # return self.lin(neighbor_mean)
        out = self.lin(neighbor_mean)
        if self.use_batch_norm:
            out = self.bn(out)
        out = self.dropout(out)
        return out

class MultiGraphEncoder(nn.Module): # three layer mean pooling encoder with dense skip connections
    def __init__(self, in_channels, hidden_channels, out_channels, use_input_proj=True, use_batch_norm=False): # optional input projection: transforms raw static embeddings into a hidden space
        super().__init__()
        self.use_input_proj = use_input_proj
        if use_input_proj:
            self.input_proj = nn.Sequential(
                nn.Linear(in_channels, hidden_channels), # W_proj: (in_channels -> hidden_channels)
                nn.BatchNorm1d(hidden_channels) if use_batch_norm else nn.Identity(),
                nn.LeakyReLU(0.2), # activation after projection
                nn.Dropout(0.1) # dropout for regularisation
            )
            self.mp1 = MeanPool(hidden_channels, hidden_channels, use_batch_norm=use_batch_norm) # the first mean pool now receives hidden_channels since the input is projected
            self.skip_proj = nn.Linear(hidden_channels, hidden_channels) # transforms input after projection to match hidden size for skip connection
        else:
            self.mp1 = MeanPool(in_channels, hidden_channels, use_batch_norm=use_batch_norm)
            self.skip_proj = nn.Linear(in_channels, hidden_channels)
        
        self.mp2 = MeanPool(hidden_channels, hidden_channels, use_batch_norm=use_batch_norm)
        self.mp3 = MeanPool(hidden_channels, out_channels, use_batch_norm=use_batch_norm)
        self.activation = nn.LeakyReLU(0.2)

    def forward(self, x, edge_index):
        if self.use_input_proj:
            x = self.input_proj(x) # x shape: (N, in_channels) -> (N, hidden_channels) (project 768 -> hidden_channels 512)
        x_skip = self.skip_proj(x) # (N, hidden_channels)
        h1 = self.activation(self.mp1(x, edge_index)) # h1 = sigma_activation(mp1(X, A)), adds the projected input features to the first layer's output before second mp
        h2 = self.activation(self.mp2(h1 + x_skip, edge_index)) # h2 = sigma_activation(mp2(h1 + X_skip, A))
        out = self.activation(self.mp3(h2 + h1 + x_skip, edge_index)) # out = sigma_activation(mp3(h2 + h1 + X_skip), A) adds both first layer output h1 and the projected input X_skip to h2
        return out

class Discriminator(nn.Module): # discriminator = a bilinear scorer between node embedding h_i and a global summary vector s
    # the score is later passed through a sigmoid (BCEWithLogitsLoss) to produce a probability that the pair (h_i, s) is a positive example
    def __init__(self, channels):
        super().__init__()
        self.bilinear = nn.Bilinear(channels, channels, 1)
        # computes a scalar h_i^T*W*s + b

    def forward(self, h, s):
        # h: (N, channels)
        # s is copied for the bilinear layer
        if s.dim() == 1: # detects single summary case and expands it to (N, channels) to match the bilinear input requirements
            s = s.unsqueeze(0).repeat(h.size(0), 1) # s: (channels,) => (N, channels) determined by repeat, where N is the number of nodes and channels is the output dimension of the encoder
        # now s is (N, channels) in all cases
        return self.bilinear(h, s) # the bilinear(h_i, s) score => (N, 1)

def readout(h, batch): # readout aggregates node embeddings into a global graph summary vector
    return scatter(h, batch, dim=0, reduce='mean') # # the mean of the sum of all node embeddings for each graph, s: (num_graphs, channels)
    # no sigmoid in order to improve recall since no magnitude info is lost if I were to compress values in a range 

# corruption as a fallback for single graph batch
def corruption(x, edge_index, batch): # shuffling the feature vectors among nodes
    # shuffling node features within each graph, but keeping the graph structure and batch unmodified
    # in the single graph case we simply permute the rows of X
    # in the batched case we must permute only within each individual graph, otherwise features would be mixed from unrelated subgraphs
    # PyG's Batch object stores the boundaries of each subgraph in batch.ptr, used to restrict the permutation to the slice of x belonging to each graph

    x_corr = x.clone()
    for i in range(batch.num_graphs): # trying to retrieve the node range for graph i
        if i == 0:
            start = 0
        else:
            start = batch.ptr[i].item()
        end = batch.ptr[i + 1].item()

        perm = torch.randperm(end-start, device=x.device) # shuffle x row wise to create a fake feature matrix, with the intention to keep edge_index unchanged
        # (X, A) => (X[perm], A) = (X_tilde, A), the adjancency matrix remains unchanged
         
        x_corr[start:end] = x_corr[start + perm] # applying the permutation to the node slice part of graph i

    return x_corr, edge_index # will be used to then obtain corrupted node embeddings h_tilde = GCN(X_tilde, A)

# dgi loss on multiple graphs with edge dropout
# i want the dgi to learn to make each node embedding predictive of its own graph’s global summary
def dgi_loss(encoder, discriminator, data, drop_prob=DROP_PROB, edge_drop_prob=EDGE_DROP_PROB): # binary cross‑entropy that encourages bilinear(h_i, s) to be high for real nodes and low for corrupted ones
    x = data.x
    edge_index = data.edge_index
    batch_vec = data.batch # (total_nodes,) batch is a tensor assigning each node to a graph index
    num_graphs = batch_vec.max().item() + 1

    if edge_drop_prob > 0 and encoder.training:
        edge_index, _ = dropout_edge(edge_index, p=edge_drop_prob) # edge dropout for data augmentation
    if drop_prob > 0 and encoder.training:
        x = F.dropout(x, p=drop_prob) # feature dropout on input, as regularisation and for corruption

    h = encoder(x, edge_index)
    s = readout(h, batch_vec) # (num_graphs, out_channels)

    # positive: node embeddings vs their own graph summary
    s_pos = s[batch_vec]
    logits_real = discriminator(h, s_pos) # multiple graphs are batched, each node gets its own graph's summary via s[batch]

    # negative: for each graph, the summary of a different graph in the same batch is used
    if num_graphs >= 2:
        # building a permutation with no fixed points (every graph maps to a different graph)
        device = s.device
        if num_graphs == 2:
            perm = torch.tensor([1, 0], device=device)
        else:
            # rand permutation,rejecting it if any self pair remains
            perm = torch.randperm(num_graphs, device=device)
            while (perm == torch.arange(num_graphs, device=device)).any():
                perm = torch.randperm(num_graphs, device=device)
        s_neg = s[perm] # (num_graphs, out_channels)
        s_neg = s_neg[batch_vec] # assign to each node
        logits_fake = discriminator(h, s_neg)
    else:
        # fallback: when only one graph in batch, use original feature shuffling
        # corruption needs the whole data object to access .ptr and .num_graphs
        x_corr, _ = corruption(x, edge_index, data)
        h_corr = encoder(x_corr, edge_index)
        logits_fake = discriminator(h_corr, s_pos)

    bce = nn.BCEWithLogitsLoss()
    # log(y_hat) remains => as close to 1 as possible, log(1-y_hat) => as close to 0
    # real nodes, the actual patch representations h_i and the global summary s => the discriminator outputs a high probability, label 1
    # corrupted nodes, h_corr generated from a shuffled feature matrix => the discriminator outputs a low probability, label 0
    loss = bce(logits_real, torch.ones_like(logits_real)) + bce(logits_fake, torch.zeros_like(logits_fake))
    return loss

if __name__ == "__main__": # without this guard the training code runs again if its imported in another file
    # finding all preprocessed pickle files inside project folders
    pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl"))
    print(f"Found {len(pkl_files)} preprocessed graph pickles:")
    if len(pkl_files) == 0:
        raise FileNotFoundError("No preprocessed graphs found, run preprocess_graphs.py first")

    graph_list = []
    for pkl_file in pkl_files:
        data, _, _ = load_graph_bundle(pkl_file)

        graph_list.append(data)

    print(f"Loaded {len(graph_list)} projects, feature dim: {graph_list[0].x.size(1)}")
    in_channels = graph_list[0].x.size(1)

    effective_batch_size = min(BATCH_SIZE, len(graph_list))
    if effective_batch_size < 2 and len(graph_list) >= 2:
        print(f"Warning: batch size increased to 2 (needs at least 2 graphs for cross-graph negatives)")
        effective_batch_size = 2

    loader = DataLoader(graph_list, batch_size=effective_batch_size, shuffle=True)

    encoder = MultiGraphEncoder(in_channels, HIDDEN_CHANNELS, OUT_CHANNELS, use_input_proj=True, use_batch_norm=USE_BATCH_NORM).to(DEVICE)
    discriminator = Discriminator(OUT_CHANNELS).to(DEVICE)
    optimizer = torch.optim.Adam(list(encoder.parameters()) + list(discriminator.parameters()), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=SCHEDULER_FACTOR, patience=SCHEDULER_PATIENCE)

    epoch_losses = [] # storing the average loss per epoch
    print("Training the inductive DGI model...")
    for epoch in range(1, EPOCHS + 1):
        encoder.train()
        discriminator.train()
        total_loss = 0.0
        for batch in loader:
            batch = batch.to(DEVICE)
            optimizer.zero_grad()
            loss = dgi_loss(encoder, discriminator, batch) # pass the whole Data batch object
            loss.backward()

            # gradient clipping to prevent exploding gradients
            torch.nn.utils.clip_grad_norm_(encoder.parameters(), max_norm=1.0)
            torch.nn.utils.clip_grad_norm_(discriminator.parameters(), max_norm=1.0)
            
            optimizer.step()
            total_loss += loss.item() * batch.num_graphs

        avg_loss = total_loss / len(graph_list)
        epoch_losses.append(avg_loss)
        scheduler.step(avg_loss)
        if epoch % 5 == 0 or epoch == 1:
            print(f"\tepoch {epoch:03d}, avg loss: {avg_loss:.4f}, lr: {optimizer.param_groups[0]['lr']:.2e}")

    torch.save(encoder.state_dict(), MODEL_SAVE_PATH)
    print(f"\nUnsupervised encoder saved to {MODEL_SAVE_PATH}")