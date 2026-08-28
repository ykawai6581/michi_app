"""Compare all N13 ordinary national roads in the study area with OSM Route 20.

This is deliberately a diagnostic, not a production road-selection pipeline.  It
does not buffer an all-road shortlist and it does not merge the N13 carriageways.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import numpy as np


DEFAULT_N13 = Path("data/fixtures/n13-shinjuku.geojson")
DEFAULT_OSM = Path("data/cache/osm-route-20.geojson")
DEFAULT_OUTPUT = Path("public/data/diagnostics/n13-national-roads-route-20.geojson")
METRIC_CRS = "EPSG:6677"  # JGD2011 / Japan Plane Rectangular CS IX (Tokyo)
STUDY_BBOX = (139.6000, 35.6500, 139.7800, 35.7200)
SAMPLE_INTERVAL_METERS = 5.0
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def route_query() -> str:
    south, west, north, east = STUDY_BBOX[1], STUDY_BBOX[0], STUDY_BBOX[3], STUDY_BBOX[2]
    # Include both explicit ref tagging and members of the national Route 20
    # relation.  Names are intentionally not used as the primary identifier.
    return f"""[out:json][timeout:180];
relation[\"type\"=\"route\"][\"route\"=\"road\"][\"ref\"=\"20\"]({south},{west},{north},{east})->.r;
way[\"highway\"][\"ref\"~\"(^|;)\\\\s*20\\\\s*(;|$)\"]({south},{west},{north},{east})->.w;
way(r.r)->.rw;
(.w;.rw;);
out tags geom;"""


def download_osm(output: Path, endpoint: str) -> None:
    request = Request(
        f"{endpoint}?{urlencode({'data': route_query()})}",
        headers={"Accept": "application/json", "User-Agent": "michi-map-route20-diagnostic/0.1"},
    )
    with urlopen(request, timeout=210) as response:  # noqa: S310 - configured Overpass endpoint
        payload = json.load(response)
    features = []
    for element in payload["elements"]:
        coordinates = [[point["lon"], point["lat"]] for point in element.get("geometry", [])]
        if len(coordinates) < 2:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "osm_way_id": element["id"],
                "name": element.get("tags", {}).get("name"),
                "ref": element.get("tags", {}).get("ref"),
                "route20_source": "ref=20 and/or route relation membership",
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })
    if not features:
        raise RuntimeError("Overpass returned no Route 20 ways")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + "\n")


def sampled_distances(line, reference, interval: float) -> np.ndarray:
    """Distances at the endpoints and regular points along an N13 feature."""
    parts = list(line.geoms) if line.geom_type == "MultiLineString" else [line]
    samples = []
    for part in parts:
        offsets = np.arange(0.0, part.length, interval)
        offsets = np.unique(np.append(offsets, part.length))
        samples.extend(reference.distance(part.interpolate(float(offset))) for offset in offsets)
    return np.asarray(samples)


def distribution(frame: gpd.GeoDataFrame, field: str) -> dict[str, int]:
    return dict(sorted(Counter(frame[field].fillna("<null>").astype(str)).items()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n13", type=Path, default=DEFAULT_N13)
    parser.add_argument("--osm", type=Path, default=DEFAULT_OSM)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--overpass-url", default=OVERPASS_URL)
    parser.add_argument("--refresh-osm", action="store_true")
    args = parser.parse_args()

    if args.refresh_osm or not args.osm.exists():
        download_osm(args.osm, args.overpass_url)

    n13 = gpd.read_file(args.n13)
    osm = gpd.read_file(args.osm)
    required = {"N13_002", "N13_003", "N13_004", "N13_006"}
    missing = required.difference(n13.columns)
    if missing:
        raise RuntimeError(f"Missing N13 attributes: {sorted(missing)}")
    if n13.crs is None:
        n13 = n13.set_crs("EPSG:6668")
    if osm.crs is None:
        osm = osm.set_crs("EPSG:4326")

    all_metric = n13.to_crs(METRIC_CRS)
    national = all_metric[all_metric["N13_003"].astype(str) == "1"].copy()
    if national.empty:
        raise RuntimeError('No features remain after N13_003 == "1"')
    reference = osm.to_crs(METRIC_CRS).geometry.union_all()
    national["n13_length_m"] = national.geometry.length.round(3)

    minima, medians, p90s, counts = [], [], [], []
    for geometry in national.geometry:
        distances = sampled_distances(geometry, reference, SAMPLE_INTERVAL_METERS)
        minima.append(float(geometry.distance(reference)))
        medians.append(float(np.median(distances)))
        p90s.append(float(np.percentile(distances, 90)))
        counts.append(len(distances))
    national["route20_min_m"] = np.round(minima, 3)
    national["route20_median_m"] = np.round(medians, 3)
    national["route20_p90_m"] = np.round(p90s, 3)
    national["route20_sample_count"] = counts
    national["route20_sample_interval_m"] = SAMPLE_INTERVAL_METERS
    national["michi_diagnostic"] = "n13_national_vs_osm_route20"

    median_values = np.sort(national["route20_median_m"].to_numpy())
    median_gaps = np.diff(median_values)
    largest_gap_index = int(np.argmax(median_gaps)) if len(median_gaps) else None
    histogram_edges = [0, 2, 5, 10, 20, 50, 100, 250, 500, 1000, float("inf")]
    histogram_counts, _ = np.histogram(median_values, bins=histogram_edges)
    histogram = {
        f"{start:g}–{'inf' if np.isinf(end) else f'{end:g}'}": int(count)
        for start, end, count in zip(histogram_edges, histogram_edges[1:], histogram_counts)
    }
    report = {
        "inputs": {"n13": str(args.n13), "osmRoute20": str(args.osm)},
        "method": {
            "filter": 'N13_003 == "1"',
            "metricCrs": METRIC_CRS,
            "sampleIntervalMeters": SAMPLE_INTERVAL_METERS,
            "osmReference": "ways with ref=20 and/or members of route=road, ref=20 relations",
            "selectionThreshold": None,
        },
        "counts": {"before": len(all_metric), "after": len(national)},
        "lengthMeters": {
            "before": round(float(all_metric.geometry.length.sum()), 3),
            "after": round(float(national.geometry.length.sum()), 3),
        },
        "shortlistDistributions": {field: distribution(national, field) for field in ("N13_002", "N13_004", "N13_006")},
        "featureResidualMeters": {
            field: {str(p): round(float(np.percentile(national[field], p)), 3) for p in (0, 10, 25, 50, 75, 90, 95, 100)}
            for field in ("route20_min_m", "route20_median_m", "route20_p90_m")
        },
        "medianResidualPopulation": {
            "histogramMeters": histogram,
            "largestAdjacentGapMeters": (
                round(float(median_gaps[largest_gap_index]), 3) if largest_gap_index is not None else None
            ),
            "gapBoundsMeters": (
                [float(median_values[largest_gap_index]), float(median_values[largest_gap_index + 1])]
                if largest_gap_index is not None else None
            ),
            "interpretation": (
                "Inspect the histogram and mapped GeoJSON to determine whether the low-residual group is "
                "spatially continuous along Route 20. The largest numeric gap is diagnostic only, not a threshold."
            ),
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    national.to_crs("EPSG:4326").to_file(args.output, driver="GeoJSON")
    national.drop(columns="geometry").to_csv(args.output.with_suffix(".csv"), index=False)
    args.output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
