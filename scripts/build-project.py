#!/usr/bin/env python3
"""Build a configured static project bundle."""
import argparse, json
from pathlib import Path
from project_builder import ProjectBuildError, materialize_project

parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("project_id")
args = parser.parse_args()
try:
    manifest = materialize_project(Path(__file__).resolve().parents[1], args.project_id)
except (ProjectBuildError, ValueError, json.JSONDecodeError) as error:
    parser.exit(2, f"Project build failed: {error}\n")
print(f"Built project {args.project_id!r} in public/projects/{args.project_id}")
for name, count in manifest["featureCounts"].items(): print(f"  {name}: {count}")
