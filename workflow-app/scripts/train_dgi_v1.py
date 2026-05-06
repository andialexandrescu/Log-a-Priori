import torch
import os
from pathlib import Path
import pickle
from torch_geometric.data import Data
import torch
import torch.nn as nn
from torch_geometric.loader import DataLoader
from torch_geometric.nn import GCNConv
from torch_geometric.utils import scatter
from pathlib import Path

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell"
MODEL_SAVE_PATH = BASE_DIR / "dgi_encoder_universal.pt"

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
HIDDEN_CHANNELS = 256
OUT_CHANNELS = 512
EPOCHS = 100
BATCH_SIZE = 2 # number of graphs per batch
LR = 1e-3

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

class GCNEncoder(nn.Module):
    def __init__(self, in_channels, hidden_channels, out_channels):
        super().__init__()
        # initial approach: a two layer GCN only sees immediate neighbours
        self.conv1 = GCNConv(in_channels, hidden_channels) # takes x, edge_index and outputs node embeddings denoted by h 
        self.conv2 = GCNConv(hidden_channels, out_channels)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index).relu() # h_conv1 = sigma_activation(a_tilde*X*W_0) where a' = normalized adjancency matrix with self loops
        x = self.conv2(x, edge_index) # h_conv2 = a'*h_conv1*W_1
        return x

class Discriminator(nn.Module): # discriminator = a bilinear scorer between node embedding h_i and a global summary vector s
    def __init__(self, channels):
        super().__init__()
        self.bilinear = nn.Bilinear(in1_features=channels, in2_features=channels, out_features=1) # a function that maps inputs to outputs using a linear mapping for each input vector independently
        # computes a scalar h_i^T*W*s + b

    def forward(self, h, s):
        # h: (N, channels)
        # s is copied for the bilinear layer
        if s.dim() == 1: # detects single summary case and expands it to (N, channels) to match the bilinear input requirements
            s = s.unsqueeze(0).repeat(h.size(0), -1) # s: (channels,) => (N, channels) determined by repeat, where N is the number of nodes and channels is the output dimension of the encoder
        # now s is (N, channels) in all cases
        return self.bilinear(h, s) # the bilinear(h_i, s) score => (N, 1)

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

# i want the dgi to learn to make each node embedding predictive of its own graph’s global summary
def dgi_loss(encoder, discriminator, data): # binary cross‑entropy that encourages bilinear(h_i, s) to be high for real nodes and low for corrupted ones
    x = data.x
    edge_index = data.edge_index
    batch_vec = data.batch # (total_nodes,) batch is a tensor assigning each node to a graph index

    h = encoder(x, edge_index)
    s = scatter(h, batch_vec, dim=0, reduce='mean') # the mean of the sum of all node embeddings for each graph, s: (num_graphs, channels)
    logits_real = discriminator(h, s[batch_vec]) # multiple graphs are batched, each node gets its own graph's summary via s[batch]

    # corruption needs the whole data object to access .ptr and .num_graphs
    x_corr, _ = corruption(x, edge_index, data)
    h_corr = encoder(x_corr, edge_index)
    logits_fake = discriminator(h_corr, s[batch_vec])

    bce = nn.BCEWithLogitsLoss()
    # log(y_hat) remains => as close to 1 as possible, log(1-y_hat) => as close to 0
    # real nodes, the actual patch representations h_i and the global summary s => the discriminator outputs a high probability, label 1
    # corrupted nodes, h_corr generated from a shuffled feature matrix => the discriminator outputs a low probability, label 0
    loss_dgi = bce(logits_real, torch.ones_like(logits_real)) + bce(logits_fake, torch.zeros_like(logits_fake))

    return loss_dgi

# finding all preprocessed pickle files inside project folders
pkl_files = list(BASE_DIR.glob("*/preprocessed-graph-*.pkl")) # one folder level down
print(f"Found {len(pkl_files)} preprocessed graph pickles:")
if len(pkl_files) == 0:
    raise FileNotFoundError("No preprocessed graphs found, run preprocess-graphs.py first")

graph_list = []
for pkl_file in pkl_files:
    data, node_list, original = load_graph_bundle(pkl_file)

    graph_list.append(data)

print(f"Loaded {len(graph_list)} projects, feature dim: {graph_list[0].x.size(1)}")
in_channels = graph_list[0].x.size(1)

loader = DataLoader(graph_list, batch_size=BATCH_SIZE, shuffle=True)

encoder = GCNEncoder(in_channels, HIDDEN_CHANNELS, OUT_CHANNELS).to(DEVICE)
discriminator = Discriminator(OUT_CHANNELS).to(DEVICE)
optimizer = torch.optim.Adam(list(encoder.parameters()) + list(discriminator.parameters()), lr=LR)

epoch_losses = [] # storing the average loss per epoch
print("Training the DGI model...")
for epoch in range(1, EPOCHS+1):
    encoder.train()
    discriminator.train()
    total_loss = 0.0
    for batch in loader:
        batch = batch.to(DEVICE)
        optimizer.zero_grad()
        loss = dgi_loss(encoder, discriminator, batch) # pass the whole Data batch object
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * batch.num_graphs

    avg_loss = total_loss / len(graph_list)
    epoch_losses.append(avg_loss)
    if epoch % 20 == 0:
        print(f"\tepoch {epoch:03d}, avg loss: {avg_loss:.4f}")

torch.save(encoder.state_dict(), MODEL_SAVE_PATH)
print(f"\nUniversal encoder saved to {MODEL_SAVE_PATH}")