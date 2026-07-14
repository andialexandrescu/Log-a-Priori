# this script analyses the graph structure of each project and the accessibility of target nodes in train/ val/ test splits
# it helps understand whether test nodes are harder to retrieve than train nodes, which influences evaluation fairness
import json
from pathlib import Path
import os
from collections import defaultdict
import numpy as np
import pickle
from typing import Dict, List, Tuple

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / "3m04j6ngn2ucr7u" # superuser

def compute_graph_metrics(graph_data): # computing graph level accessibility and other metrics (density, degree distribution, percentiles)
    # used to characterise the overall graph structure, not the target nodes specifically
    if graph_data is None:
        return None
    
    nodes = graph_data.get('nodes', [])
    edges = graph_data.get('edges', [])
    
    if not nodes or not edges:
        return None
    
    num_nodes = len(nodes)
    num_edges = len(edges)
    
    degree = defaultdict(int)
    for src, dst in edges: # treat the graph as undirected
        degree[src] += 1
        degree[dst] += 1
    
    degrees = list(degree.values())
    
    density = 2 * num_edges / (num_nodes * (num_nodes - 1)) if num_nodes > 1 else 0
    avg_degree = np.mean(degrees) if degrees else 0
    median_degree = np.median(degrees) if degrees else 0
    max_degree = np.max(degrees) if degrees else 0
    
    percentile_25 = np.percentile(degrees, 25) if degrees else 0
    percentile_75 = np.percentile(degrees, 75) if degrees else 0
    percentile_90 = np.percentile(degrees, 90) if degrees else 0
    
    high_degree_nodes = sum(1 for d in degrees if d >= np.percentile(degrees, 75))
    high_degree_ratio = high_degree_nodes / num_nodes if num_nodes > 0 else 0
    
    sparsity = 1 - density
    
    return {
        'num_nodes': num_nodes,
        'num_edges': num_edges,
        'avg_degree': avg_degree,
        'median_degree': median_degree,
        'max_degree': max_degree,
        'std_degree': np.std(degrees) if degrees else 0,
        'density': density,
        'sparsity': sparsity,
        'percentile_25_degree': percentile_25,
        'percentile_75_degree': percentile_75,
        'percentile_90_degree': percentile_90,
        'high_degree_ratio': high_degree_ratio,
        'degree_distribution': degrees,
    }

def analyze_split_targets(proj_dir, split_name): # analyzing target node accessibility inside the shared project graph for a given split (train/ val/ test)
    # each split references a different set of target nodes, but the underlying project graph stays the same
    # we compute degree and 1 hop neighbourhood size for each target to see if splits are balanced
    query_files = {
        'train': proj_dir / 'nl_queries_inductive_train.json',
        'val': proj_dir / 'nl_queries_inductive_val.json',
        'test': proj_dir / 'nl_queries_inductive_test.json',
    }
    
    query_file = query_files.get(split_name)
    if not query_file or not query_file.exists():
        return None
    
    queries_dict = json.load(open(query_file))
    
    pkl_files = list(proj_dir.glob("preprocessed-graph-*.pkl"))
    if not pkl_files:
        return None
    
    try:
        pkl_path = pkl_files[0]
        with open(pkl_path, 'rb') as f:
            bundle = pickle.load(f)
        
        if "x" in bundle and "edge_index" in bundle:
            # support both raw bundle dictionaries and graph data objects saved by earlier preprocessing runs
            x = bundle["x"]
            edge_index = bundle["edge_index"]
            node_list = bundle.get("node_list", [])
        elif "data" in bundle:
            data = bundle["data"]
            edge_index = data.edge_index
            node_list = bundle.get("node_list", [])
        else:
            return None
        
        if hasattr(edge_index, 'cpu'):
            edge_np = edge_index.cpu().numpy()
        else:
            edge_np = np.array(edge_index)
        
        degree = defaultdict(int)
        adjacency = defaultdict(set)
        
        for src, dst in edge_np.T: # building undirected adjacency from edge list
            degree[src] += 1
            degree[dst] += 1
            adjacency[src].add(dst)
            adjacency[dst].add(src)
        
        id_to_idx = {}
        if node_list:
            for i, node in enumerate(node_list):
                if isinstance(node, dict) and 'id' in node:
                    id_to_idx[node['id']] = i # mapping stable node ids back to graph indices so query targets can be matched precisely
        
        target_degrees = []
        neighbor_counts = []
        
        for q_text, target_node_id in queries_dict.items(): # iterating over each query in the split file, extract target node
            if target_node_id not in id_to_idx: # skipping queries that no longer map cleanly onto the current graph snapshot
                continue
            
            target_idx = id_to_idx[target_node_id]
            
            target_degrees.append(degree[target_idx])
            
            neighbors = adjacency[target_idx]
            neighbor_counts.append(len(neighbors))
        
        if not target_degrees:
            return None
        
        return {
            'count': len(queries_dict),
            'num_total_nodes': len(node_list) if node_list else len(degree),
            'num_total_edges': len(edge_np.T) if hasattr(edge_np, 'shape') else 0,
            'graph_density': compute_graph_metrics({'nodes': list(range(len(node_list) if node_list else len(degree))), 'edges': [tuple(e) for e in edge_np.T]})['density'] if edge_np.size > 0 else 0,
            'avg_target_degree': np.mean(target_degrees),
            'median_target_degree': np.median(target_degrees),
            'max_target_degree': np.max(target_degrees),
            'min_target_degree': np.min(target_degrees),
            'std_target_degree': np.std(target_degrees),
            'percentile_25_target_deg': np.percentile(target_degrees, 25),
            'percentile_75_target_deg': np.percentile(target_degrees, 75),
            'avg_neighbors_1hop': np.mean(neighbor_counts),
            'median_neighbors_1hop': np.median(neighbor_counts),
            'percentile_75_neighbors': np.percentile(neighbor_counts, 75),
            'max_neighbors_1hop': np.max(neighbor_counts),
        }
        
    except Exception as e:
        print(f"Error loading graph: {e}")
        return None
    
def discover_projects_recursive(root_dir):
    projects = []
    for pkl_path in root_dir.rglob("preprocessed-graph-*.pkl"):
        proj_dir = pkl_path.parent
        if proj_dir not in projects:
            projects.append(proj_dir)
    return sorted(projects)

print("Graph structure analysis:")

all_stats = defaultdict(dict)
comparison_results = []
projects = discover_projects_recursive(BASE_DIR)

for proj_dir in projects:
    proj_name = proj_dir.name
    print(f"\nAnalyzing {proj_name}...")
    
    for split in ['train', 'val', 'test']:
        stats = analyze_split_targets(proj_dir, split)
        if stats:
            all_stats[proj_name][split] = stats # each split gets its own accessibility summary so we can compare target difficulty across splits
            print(f"{split}: {stats['count']} queries, ")
            print(f"\tavg target degree={stats['avg_target_degree']:.2f}, ")
            print(f"\tavg 1 hop neighbors={stats['avg_neighbors_1hop']:.2f}")

print("Global summary:")

# aggregating the per project stats into split level summary arrays for the final comparison
train_target_degrees = []
val_target_degrees = []
test_target_degrees = []

train_neighbors = []
val_neighbors = []
test_neighbors = []

train_query_counts = []
val_query_counts = []
test_query_counts = []

for proj_stats in all_stats.values(): # collecting split specific values so the final averages reflect the whole workspace, not one project
    if 'train' in proj_stats:
        train_target_degrees.append(proj_stats['train']['avg_target_degree'])
        train_neighbors.append(proj_stats['train']['avg_neighbors_1hop'])
        train_query_counts.append(proj_stats['train']['count'])
    if 'val' in proj_stats:
        val_target_degrees.append(proj_stats['val']['avg_target_degree'])
        val_neighbors.append(proj_stats['val']['avg_neighbors_1hop'])
        val_query_counts.append(proj_stats['val']['count'])
    if 'test' in proj_stats:
        test_target_degrees.append(proj_stats['test']['avg_target_degree'])
        test_neighbors.append(proj_stats['test']['avg_neighbors_1hop'])
        test_query_counts.append(proj_stats['test']['count'])

print(f"\nTarget node degree")
print(f"\ttrain: {np.mean(train_target_degrees):.2f} (+/-{np.std(train_target_degrees):.2f}), median={np.median(train_target_degrees):.2f}")
print(f"\tval: {np.mean(val_target_degrees):.2f} (+/-{np.std(val_target_degrees):.2f}), median={np.median(val_target_degrees):.2f}")
print(f"\ttest: {np.mean(test_target_degrees):.2f} (+/-{np.std(test_target_degrees):.2f}), median={np.median(test_target_degrees):.2f}")

print(f"\n1 hop neighbor count (size of target's direct neighborhood)")
print(f"\ttrain: {np.mean(train_neighbors):.2f} (+/-{np.std(train_neighbors):.2f})")
print(f"\tval: {np.mean(val_neighbors):.2f} (+/-{np.std(val_neighbors):.2f})")
print(f"\ttest: {np.mean(test_neighbors):.2f} (+/-{np.std(test_neighbors):.2f})")

degree_diff = ((np.mean(test_target_degrees) - np.mean(train_target_degrees)) / np.mean(train_target_degrees) * 100) if np.mean(train_target_degrees) > 0 else 0
neighbor_diff = ((np.mean(test_neighbors) - np.mean(train_neighbors)) / np.mean(train_neighbors) * 100) if np.mean(train_neighbors) > 0 else 0

# report relative differences so the user can see how much harder test is than train at a glance
print(f"\nRelative differences to the train split:")
print(f"\tTarget degree: {degree_diff:+.1f}%")
print(f"\t1 hop cluster: {neighbor_diff:+.1f}%")