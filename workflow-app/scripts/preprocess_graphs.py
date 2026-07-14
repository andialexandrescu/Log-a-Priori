import argparse
import gc
import os
from pathlib import Path

import torch

from graph_embeddings import ( BASE_DIR, ensure_preprocessed_graph, find_all_graph_jsons, find_project_pickles, pkl_path_for_json )

parser = argparse.ArgumentParser(description="Batch-preprocess project graphs into pickle files")
parser.add_argument(
    "--refresh",
    action="store_true",
    help="Rebuild pickle even if one already exists for the project",
)
args = parser.parse_args()

TRAINING_USER_ID = os.environ.get("LOG_A_PRIORI_TRAINING_USER_ID", "3m04j6ngn2ucr7u").strip()
SCAN_BASE = BASE_DIR / TRAINING_USER_ID if TRAINING_USER_ID else BASE_DIR

json_files = find_all_graph_jsons(SCAN_BASE)
print(f"Found {len(json_files)} {SCAN_BASE.name}/*/analysis/ts-code-graph.json files")

skipped = 0
processed = 0

for index, jf in enumerate(json_files):
    print(f"\n[{index + 1}/{len(json_files)}] Processing: {jf}")
    project_root = jf.parent.parent
    project_id = project_root.name
    print(f"Project root: {project_root}, project: {project_id}")

    existing_pkls = find_project_pickles(project_root)
    if existing_pkls and not args.refresh:
        expected = pkl_path_for_json(jf, project_root)
        print(
            f"Skipping {project_id}: already has {len(existing_pkls)} preprocessed graph pickle(s)"
        )
        for pkl_path in existing_pkls:
            marker = " (matches current graph json)" if pkl_path == expected else ""
            print(f"\t- {pkl_path.name}{marker}")
        skipped += 1
        continue

    out_file = ensure_preprocessed_graph(project_root, refresh=args.refresh)
    print(f"Saved to: {out_file}")
    processed += 1

print(f"\nPreprocessing is complete ({processed} built, {skipped} skipped)")

torch.cuda.empty_cache()
gc.collect()