"""Filter a large MLIT N13 source into class-partitioned GeoParquet caches."""

from __future__ import annotations

import argparse
from pathlib import Path

import geopandas as gpd
import pandas as pd


AVAILABLE_ROAD_CLASSES = {"1", "2", "3"}
DEFAULT_ROAD_CLASSES = {"1", "2"}


def preprocess_n13(source: Path, output: Path, classes=DEFAULT_ROAD_CLASSES,
                   chunk_size: int = 25_000) -> dict:
    """Read *source* in bounded chunks and write one partition per requested class."""
    classes = {str(value) for value in classes}
    unsupported = classes - AVAILABLE_ROAD_CLASSES
    if not classes or unsupported:
        raise ValueError(f"classes must be a non-empty subset of {sorted(AVAILABLE_ROAD_CLASSES)}")
    retained = {road_class: [] for road_class in classes}
    read_count = 0
    start = 0
    while True:
        chunk = gpd.read_file(source, rows=slice(start, start + chunk_size))
        if chunk.empty:
            break
        read_count += len(chunk)
        if "N13_003" not in chunk:
            raise RuntimeError(f"{source} has no N13_003 road-class field")
        road_classes = chunk["N13_003"].astype(str)
        for road_class in classes:
            selected = chunk[road_classes == road_class].copy()
            if not selected.empty:
                retained[road_class].append(selected)
        start += len(chunk)
        if len(chunk) < chunk_size:
            break
    outputs = {}
    retained_count = 0
    for road_class in sorted(classes):
        if not retained[road_class]:
            continue
        roads = pd.concat(retained[road_class], ignore_index=True)
        roads = gpd.GeoDataFrame(roads, geometry="geometry", crs=retained[road_class][0].crs)
        partition = output / f"class={road_class}" / "roads.parquet"
        partition.parent.mkdir(parents=True, exist_ok=True)
        roads.to_parquet(partition, index=False)
        outputs[road_class] = str(partition)
        retained_count += len(roads)
    if not outputs:
        raise RuntimeError(f"{source} contains none of the requested N13 road classes {sorted(classes)}")
    return {"sourceFeatureCount": read_count, "retainedFeatureCount": retained_count,
            "classes": sorted(classes), "outputs": outputs}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="raw N13 GeoJSON (for example data/raw/n13/N13.geojson)")
    parser.add_argument("--output", type=Path, default=Path("data/cache/n13/roads"),
                        help="partition root; files are written below class=N/")
    parser.add_argument("--classes", nargs="+", choices=sorted(AVAILABLE_ROAD_CLASSES),
                        default=sorted(DEFAULT_ROAD_CLASSES), help="N13_003 classes to cache (default: 1 2)")
    parser.add_argument("--chunk-size", type=int, default=25_000)
    args = parser.parse_args()
    print(preprocess_n13(args.source, args.output, args.classes, args.chunk_size))


if __name__ == "__main__":
    main()
