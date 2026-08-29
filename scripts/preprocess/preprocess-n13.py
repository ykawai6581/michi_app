"""Filter a large MLIT N13 source into class-partitioned GeoParquet caches."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd


AVAILABLE_ROAD_CLASSES = {"1", "2", "3"}
DEFAULT_ROAD_CLASSES = {"1", "2"}


def partition_root(output: Path) -> Path:
    """Normalize the former single-Parquet CLI spelling to the partition root."""
    return output.with_suffix("") if output.suffix.lower() in {".parquet", ".geoparquet"} else output


def preprocess_n13(source: Path, output: Path, classes=DEFAULT_ROAD_CLASSES,
                   chunk_size: int = 25_000) -> dict:
    """Read *source* in bounded chunks and write one partition per requested class."""
    classes = {str(value) for value in classes}
    unsupported = classes - AVAILABLE_ROAD_CLASSES
    if not classes or unsupported:
        raise ValueError(f"classes must be a non-empty subset of {sorted(AVAILABLE_ROAD_CLASSES)}")
    retained = {road_class: [] for road_class in classes}
    read_count = 0
    source_crs = None
    bounds = None
    start = 0
    while True:
        chunk = gpd.read_file(source, rows=slice(start, start + chunk_size))
        if chunk.empty:
            break
        read_count += len(chunk)
        source_crs = source_crs or chunk.crs
        chunk_bounds = chunk.to_crs("EPSG:4326").total_bounds
        bounds = chunk_bounds if bounds is None else [
            min(bounds[0], chunk_bounds[0]), min(bounds[1], chunk_bounds[1]),
            max(bounds[2], chunk_bounds[2]), max(bounds[3], chunk_bounds[3]),
        ]
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
    root = partition_root(output)
    outputs = {}
    retained_count = 0
    for road_class in sorted(classes):
        if not retained[road_class]:
            continue
        roads = pd.concat(retained[road_class], ignore_index=True)
        roads = gpd.GeoDataFrame(roads, geometry="geometry", crs=retained[road_class][0].crs)
        feature_bounds = roads.to_crs("EPSG:4326").geometry.bounds
        roads[["bbox_west", "bbox_south", "bbox_east", "bbox_north"]] = feature_bounds.to_numpy()
        partition = root / f"class={road_class}" / "roads.parquet"
        partition.parent.mkdir(parents=True, exist_ok=True)
        roads.to_parquet(partition, index=False)
        outputs[road_class] = str(partition)
        retained_count += len(roads)
    if not outputs:
        raise RuntimeError(f"{source} contains none of the requested N13 road classes {sorted(classes)}")
    manifest_path = root / "manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    available = sorted(set(previous.get("availableClasses", [])) | set(outputs))
    manifest = {
        "source": str(source), "sourceFeatureCount": read_count,
        "sourceCrs": source_crs.to_string() if source_crs else None,
        "boundsWgs84": [round(float(value), 9) for value in bounds],
        "availableClasses": available,
        "partitions": {**previous.get("partitions", {}), **{
            road_class: {"path": outputs[road_class], "featureCount": sum(len(frame) for frame in retained[road_class])}
            for road_class in outputs}},
    }
    root.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return {"sourceFeatureCount": read_count, "retainedFeatureCount": retained_count,
            "classes": sorted(classes), "requestedOutput": str(output), "cacheRoot": str(root),
            "manifest": str(manifest_path), "boundsWgs84": manifest["boundsWgs84"], "outputs": outputs}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="raw N13 GeoJSON (for example data/raw/n13/N13.geojson)")
    parser.add_argument("--output", type=Path, default=Path("data/cache/n13/roads"),
                        help="partition root; legacy PATH.parquet is normalized to PATH before writing class=N/")
    parser.add_argument("--classes", nargs="+", choices=sorted(AVAILABLE_ROAD_CLASSES),
                        default=sorted(DEFAULT_ROAD_CLASSES), help="N13_003 classes to cache (default: 1 2)")
    parser.add_argument("--chunk-size", type=int, default=25_000)
    args = parser.parse_args()
    print(preprocess_n13(args.source, args.output, args.classes, args.chunk_size))


if __name__ == "__main__":
    main()
