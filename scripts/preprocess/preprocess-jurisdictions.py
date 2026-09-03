#!/usr/bin/env python3
"""Normalize a supplied local Geoshape historical-jurisdiction GeoJSON or TopoJSON file."""
import argparse
from pathlib import Path

from jurisdiction_source import write_snapshot

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--provider", choices=["geoshape"], default="geoshape")
parser.add_argument("--prefecture", required=True, help="JIS prefecture code; initial supported value is 13")
parser.add_argument("--prefecture-name", default="Tokyo")
parser.add_argument("--resolution", choices=["low", "high"], default="low")
parser.add_argument("--snapshot-date", required=True, help="Actual source snapshot date (YYYY-MM-DD)")
parser.add_argument("--input", type=Path, required=True, help="Supplied local GeoJSON FeatureCollection or TopoJSON Topology")
parser.add_argument("--topology-object", help="TopoJSON object name (defaults to city when present)")
parser.add_argument("--output", type=Path, default=Path("public/data/jurisdictions"))
args = parser.parse_args()
if args.prefecture != "13": parser.error("this first release supports Tokyo prefecture code 13 only")
try: write_snapshot(args.input, args.output, prefecture=args.prefecture, prefecture_name=args.prefecture_name, snapshot_date=args.snapshot_date, resolution=args.resolution, topology_object=args.topology_object)
except (OSError, ValueError) as error: parser.exit(2, f"Jurisdiction preprocessing failed: {error}\n")
print(f"Wrote {args.provider} {args.prefecture} {args.resolution} snapshot {args.snapshot_date} under {args.output}")
