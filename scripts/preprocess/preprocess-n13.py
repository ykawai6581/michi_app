"""Filter a large MLIT N13 source into a reusable road-only GeoParquet cache."""

from __future__ import annotations

import argparse
from pathlib import Path

import geopandas as gpd
import pandas as pd


ROAD_CLASSES = {"1", "2", "3"}


def preprocess_n13(source: Path, output: Path, chunk_size: int = 25_000) -> dict:
    """Read *source* in bounded chunks and retain statutory road classes 1-3."""
    retained = []
    read_count = 0
    start = 0
    while True:
        chunk = gpd.read_file(source, rows=slice(start, start + chunk_size))
        if chunk.empty:
            break
        read_count += len(chunk)
        if "N13_003" not in chunk:
            raise RuntimeError(f"{source} has no N13_003 road-class field")
        selected = chunk[chunk["N13_003"].astype(str).isin(ROAD_CLASSES)].copy()
        if not selected.empty:
            retained.append(selected)
        start += len(chunk)
        if len(chunk) < chunk_size:
            break
    if not retained:
        raise RuntimeError(f"{source} contains no N13 road classes 1, 2, or 3")
    roads = pd.concat(retained, ignore_index=True)
    roads = gpd.GeoDataFrame(roads, geometry="geometry", crs=retained[0].crs)
    output.parent.mkdir(parents=True, exist_ok=True)
    roads.to_parquet(output, index=False)
    return {"sourceFeatureCount": read_count, "retainedFeatureCount": len(roads), "output": str(output)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="raw N13 GeoJSON (for example data/raw/n13/N13.geojson)")
    parser.add_argument("--output", type=Path, default=Path("data/cache/n13/roads.parquet"))
    parser.add_argument("--chunk-size", type=int, default=25_000)
    args = parser.parse_args()
    print(preprocess_n13(args.source, args.output, args.chunk_size))


if __name__ == "__main__":
    main()
