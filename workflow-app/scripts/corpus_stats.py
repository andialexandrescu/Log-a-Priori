import argparse
import json
import os
import random
from pathlib import Path

APPDATA = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
TRAINING_USER_ID = os.environ.get("LOG_A_PRIORI_TRAINING_USER_ID", "3m04j6ngn2ucr7u").strip()
BASE_DIR = Path(APPDATA) / "log-a-priori-desktop-shell" / TRAINING_USER_ID

GRAPH_JSON = "analysis/ts-code-graph.json"
TRAIN_QUERIES_JSON = "nl_queries_inductive_train.json"
VAL_QUERIES_JSON = "nl_queries_inductive_val.json"
TEST_QUERIES_JSON = "nl_queries_inductive_test.json"

PROJECTION_TRAIN_RATIO = 0.8
FINETUNE_VALIDATION_SPLIT = 0.40
FINETUNE_RANDOM_SEED = 42

def discover_project_dirs(base_dir):
    project_dirs = []
    for pkl_path in sorted(base_dir.glob("*/preprocessed-graph-*.pkl")):
        proj_dir = pkl_path.parent
        if proj_dir not in project_dirs:
            project_dirs.append(proj_dir)
    return project_dirs

def load_graph_json(proj_dir):
    graph_path = proj_dir / GRAPH_JSON
    if not graph_path.exists():
        return None
    with open(graph_path, encoding="utf-8") as f:
        return json.load(f)

def graph_payload(graph_doc):
    if not graph_doc:
        return {}
    payload = graph_doc.get("graph")
    return payload if isinstance(payload, dict) else {}

def node_ids_from_graph(graph_doc):
    ids: set[str] = set()
    for node in graph_payload(graph_doc).get("nodes", []):
        if isinstance(node, dict) and isinstance(node.get("id"), str):
            ids.add(node["id"])
    return ids

def graph_summary(graph_doc):
    if graph_doc and graph_doc.get("summary"):
        summary = graph_doc["summary"]
        return (
            int(summary.get("functions", 0)),
            int(summary.get("totalEdges", 0)),
            int(summary.get("filesAnalyzed", 0)),
        )

    payload = graph_payload(graph_doc)
    if payload:
        return len(payload.get("nodes", [])), len(payload.get("edges", [])), 0

    return 0, 0, 0

def project_repository(graph_doc, proj_dir):
    if graph_doc:
        for node in graph_payload(graph_doc).get("nodes", []):
            repo = node.get("repository")
            if isinstance(repo, str) and repo.strip():
                return repo.strip()

    commits_dir = proj_dir / "commits"
    if not commits_dir.exists():
        return None

    for manifest_path in sorted(commits_dir.rglob("manifest.json")):
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
            repo = manifest.get("repository")
            if isinstance(repo, str) and repo.strip():
                return repo.strip()
        except (OSError, json.JSONDecodeError):
            continue
    return None

def valid_query_pairs(proj_dir, node_ids, queries_filename):
    queries_path = proj_dir / queries_filename
    if not queries_path.exists() or not node_ids:
        return 0

    with open(queries_path, encoding="utf-8") as f:
        queries = json.load(f)

    return sum(1 for _, node_id in queries.items() if node_id in node_ids)

def finetune_split_counts(project_dirs):
    rng = random.Random(FINETUNE_RANDOM_SEED)
    shuffled = list(project_dirs)
    rng.shuffle(shuffled)

    val_project_count = max(1, int(len(shuffled) * FINETUNE_VALIDATION_SPLIT))
    val_projects = set(shuffled[:val_project_count])
    train_projects = [d for d in shuffled if d not in val_projects]

    train_pairs = 0
    val_pairs = 0
    for proj_dir in project_dirs:
        graph = load_graph_json(proj_dir)
        count = valid_query_pairs(proj_dir, node_ids_from_graph(graph), TRAIN_QUERIES_JSON)
        if proj_dir in val_projects:
            val_pairs += count
        else:
            train_pairs += count

    return train_pairs, val_pairs, len(train_projects), len(val_projects)

def collect_stats(base_dir):
    project_dirs = discover_project_dirs(base_dir)

    totals = {
        "projects_with_pickle": 0,
        "projects_with_graph_json": 0,
        "nodes": 0,
        "edges": 0,
        "files_analyzed": 0,
        "query_pairs_train_valid": 0,
        "query_pairs_val_valid": 0,
        "query_pairs_test_valid": 0,
        "projection_train_pairs": 0,
        "projection_val_pairs": 0,
        "finetune_train_pairs": 0,
        "finetune_val_pairs": 0,
        "finetune_train_projects": 0,
        "finetune_val_projects": 0,
        "distinct_github_repositories": 0,
        "projects_with_github_repository": 0,
        "projects_without_github_repository": 0,
    }
    repositories: set[str] = set()
    per_project = []

    for proj_dir in project_dirs:
        graph = load_graph_json(proj_dir)
        node_ids = node_ids_from_graph(graph)
        nodes, edges, files = graph_summary(graph)
        repo = project_repository(graph, proj_dir)

        train_pairs = valid_query_pairs(proj_dir, node_ids, TRAIN_QUERIES_JSON)
        val_pairs = valid_query_pairs(proj_dir, node_ids, VAL_QUERIES_JSON)
        test_pairs = valid_query_pairs(proj_dir, node_ids, TEST_QUERIES_JSON)

        totals["projects_with_pickle"] += 1
        if graph is not None:
            totals["projects_with_graph_json"] += 1
        totals["nodes"] += nodes
        totals["edges"] += edges
        totals["files_analyzed"] += files
        totals["query_pairs_train_valid"] += train_pairs
        totals["query_pairs_val_valid"] += val_pairs
        totals["query_pairs_test_valid"] += test_pairs

        if repo:
            repositories.add(repo)
            totals["projects_with_github_repository"] += 1
        else:
            totals["projects_without_github_repository"] += 1

        per_project.append(
            {
                "project_id": proj_dir.name,
                "nodes": nodes,
                "edges": edges,
                "files_analyzed": files,
                "repository": repo,
                "query_pairs_train": train_pairs,
                "query_pairs_val": val_pairs,
                "query_pairs_test": test_pairs,
            }
        )

    projection_split = int(PROJECTION_TRAIN_RATIO * totals["query_pairs_train_valid"])
    totals["projection_train_pairs"] = projection_split
    totals["projection_val_pairs"] = totals["query_pairs_train_valid"] - projection_split

    (
        totals["finetune_train_pairs"],
        totals["finetune_val_pairs"],
        totals["finetune_train_projects"],
        totals["finetune_val_projects"],
    ) = finetune_split_counts(project_dirs)
    totals["distinct_github_repositories"] = len(repositories)

    return {
        "base_dir": str(base_dir),
        "training_user_id": TRAINING_USER_ID,
        "totals": totals,
        "repositories": sorted(repositories),
        "per_project": per_project,
    }

def print_report(stats: dict, *, per_project: bool) -> None:
    totals = stats["totals"]
    print(f"Corpus root: {stats['base_dir']}")
    print()
    print("Graph structure (from ts-code-graph.json summary, pickle fallback):")
    print(f"\tprojects with preprocessed pickle: {totals['projects_with_pickle']}")
    print(f"\tprojects with ts-code-graph.json: {totals['projects_with_graph_json']}")
    print(f"\ttotal nodes (functions): {totals['nodes']}")
    print(f"\ttotal edges: {totals['edges']}")
    print(f"\ttotal files analyzed: {totals['files_analyzed']}")
    print()
    print("Query-node pairs (only pairs whose target node exists in ts-code-graph.json):")
    print(f"\ttrain queries total: {totals['query_pairs_train_valid']}")
    print(f"\tval queries total: {totals['query_pairs_val_valid']}")
    print(f"\ttest queries total: {totals['query_pairs_test_valid']}")
    print(f"\ttrain_query_projection split: {totals['projection_train_pairs']} train/ {totals['projection_val_pairs']} val")
    print(
        f"\ttrain_finetuned_dgi split: {totals['finetune_train_pairs']} train pairs from "
        f"{totals['finetune_train_projects']} projects/ {totals['finetune_val_pairs']} val pairs from "
        f"{totals['finetune_val_projects']} projects"
    )
    print()
    print("GitHub repositories:")
    print(f"\tdistinct repositories: {totals['distinct_github_repositories']}")
    print(f"\tprojects linked to a repository: {totals['projects_with_github_repository']}")
    print(f"\tprojects without repository metadata: {totals['projects_without_github_repository']}")
    if stats["repositories"]:
        print("\trepository list:")
        for repo in stats["repositories"]:
            print(f"\t\t- {repo}")

    if per_project:
        print()
        print("Per-project breakdown:")
        for row in stats["per_project"]:
            repo = row["repository"] or "(local / unknown)"
            print(
                f"\t{row['project_id']}: nodes={row['nodes']}, edges={row['edges']}, "
                f"train={row['query_pairs_train']}, val={row['query_pairs_val']}, "
                f"test={row['query_pairs_test']}, repo={repo}"
            )

parser = argparse.ArgumentParser(description="Print aggregate statistics for the ML training corpus")
parser.add_argument(
    "--base-dir",
    type=Path,
    default=BASE_DIR,
    help="Training workspace root (default: APPDATA/log-a-priori-desktop-shell/<training-user-id>)",
)
parser.add_argument(
    "--json",
    action="store_true",
    help="Print the full stats object as JSON instead of the human-readable report",
)
parser.add_argument(
    "--per-project",
    action="store_true",
    help="Include a per-project table in the human-readable report",
)
args = parser.parse_args()

if not args.base_dir.exists():
    raise FileNotFoundError(f"Corpus directory not found: {args.base_dir}")

stats = collect_stats(args.base_dir)

if args.json:
    print(json.dumps(stats, indent=2))
else:
    print_report(stats, per_project=args.per_project)
