"""Build one canonical road's display geometry from the road registry and N13."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import numpy as np
from shapely.geometry import mapping

REGISTRY = Path("data/roads/registry.json")
N13_INPUT = Path("data/fixtures/n13-shinjuku.geojson")
CACHE = Path("data/cache/roads")
PUBLIC_ROADS = Path("public/data/roads")
SEARCH_INDEX = Path("public/search/roads.json")
METRIC_CRS = "EPSG:6677"
STUDY_BBOX = (139.6000, 35.6500, 139.7800, 35.7200)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def load_road(registry_path: Path, road_id: str) -> dict:
    roads = json.loads(registry_path.read_text())["roads"]
    try:
        return next(road for road in roads if road["id"] == road_id)
    except StopIteration as error:
        raise RuntimeError(f"Unknown road id {road_id!r}; add it to {registry_path}") from error


def osm_query(road: dict) -> str:
    south, west, north, east = STUDY_BBOX[1], STUDY_BBOX[0], STUDY_BBOX[3], STUDY_BBOX[2]
    ref = road["osm"]["ref"].replace('"', '\\"')
    network = road["osm"].get("network")
    network_filter = f'["network"="{network}"]' if network else ""
    return f'''[out:json][timeout:180];
relation["type"="route"]["route"="road"]["ref"="{ref}"]{network_filter}({south},{west},{north},{east})->.r;
way["highway"]["ref"="{ref}"]({south},{west},{north},{east})->.w;
way(r.r)({south},{west},{north},{east})->.rw;
(.w;.rw;);
out tags geom;'''


def download_reference(road: dict, output: Path, endpoint: str) -> None:
    request = Request(f"{endpoint}?{urlencode({'data': osm_query(road)})}", headers={
        "Accept": "application/json", "User-Agent": "michi-map-road-matcher/0.1",
    })
    with urlopen(request, timeout=210) as response:  # noqa: S310
        payload = json.load(response)
    features = [{
        "type": "Feature",
        "properties": {"osm_way_id": item["id"], "ref": item.get("tags", {}).get("ref")},
        "geometry": {"type": "LineString", "coordinates": [[p["lon"], p["lat"]] for p in item["geometry"]]},
    } for item in payload["elements"] if len(item.get("geometry", [])) > 1]
    if not features:
        raise RuntimeError(f"OSM returned no reference geometry for {road['id']}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}) + "\n")


def distances(line, reference, interval: float) -> np.ndarray:
    parts = list(line.geoms) if line.geom_type == "MultiLineString" else [line]
    values = []
    for part in parts:
        offsets = np.unique(np.append(np.arange(0, part.length, interval), part.length))
        values.extend(reference.distance(part.interpolate(float(offset))) for offset in offsets)
    return np.asarray(values)


def reference_coverage(reference, selected_union, interval: float, tolerance: float) -> tuple[float, list[dict]]:
    parts = list(reference.geoms) if reference.geom_type == "MultiLineString" else [reference]
    samples = []
    unresolved = []
    for part_index, part in enumerate(parts):
        offsets = np.unique(np.append(np.arange(0, part.length, interval), part.length))
        covered = [selected_union.distance(part.interpolate(float(offset))) <= tolerance for offset in offsets]
        samples.extend(covered)
        if not all(covered):
            unresolved.append({"osmPart": part_index, "uncoveredSamples": covered.count(False), "samples": len(covered)})
    return 100 * sum(samples) / len(samples), unresolved


def rebuild_search_index(registry_path: Path) -> None:
    roads = json.loads(registry_path.read_text())["roads"]
    entries = [{
        "id": road["id"], "name": road["displayName"], "aliases": road["aliases"],
        "type": "road", "sources": {
            "n13": f"data/roads/{road['id']}-n13.geojson",
            "osm": f"data/roads/{road['id']}-osm.geojson",
        },
    } for road in roads if all((PUBLIC_ROADS / f"{road['id']}-{source}.geojson").exists() for source in ("n13", "osm"))]
    SEARCH_INDEX.parent.mkdir(parents=True, exist_ok=True)
    SEARCH_INDEX.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("road_id")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--n13", type=Path, default=N13_INPUT)
    parser.add_argument("--refresh-osm", action="store_true")
    parser.add_argument("--overpass-url", default=OVERPASS_URL)
    args = parser.parse_args()
    road = load_road(args.registry, args.road_id)
    reference_path = CACHE / f"{road['id']}-osm.geojson"
    if args.refresh_osm or not reference_path.exists():
        download_reference(road, reference_path, args.overpass_url)

    n13 = gpd.read_file(args.n13)
    if n13.crs is None:
        n13 = n13.set_crs("EPSG:6668")
    candidates = n13.to_crs(METRIC_CRS)
    candidates = candidates[candidates["N13_003"].astype(str) == road["n13"]["classification"]].copy()
    osm = gpd.read_file(reference_path)
    if osm.crs is None:
        osm = osm.set_crs("EPSG:4326")
    reference = osm.to_crs(METRIC_CRS).geometry.union_all()
    match = road["matching"]
    diagnostics = []
    for geometry in candidates.geometry:
        sampled = distances(geometry, reference, match["sampleIntervalMeters"])
        diagnostics.append((geometry.distance(reference), np.median(sampled), np.percentile(sampled, 90)))
    candidates[["match_min_m", "match_median_m", "match_p90_m"]] = np.round(diagnostics, 3)
    selected = candidates[
        (candidates["match_median_m"] <= match["maximumMedianResidualMeters"])
        & (candidates["match_p90_m"] <= match["maximumP90ResidualMeters"])
    ].copy()
    if selected.empty:
        raise RuntimeError(f"No plausible N13 features selected for {road['id']}")
    coverage, unresolved = reference_coverage(
        reference, selected.geometry.union_all(), match["sampleIntervalMeters"], match["coverageToleranceMeters"]
    )
    selected_wgs84 = selected.to_crs("EPSG:4326")
    common_properties = {
        "id": road["id"], "name": road["displayName"], "aliases": road["aliases"], "type": "road",
        "roadClass": road["roadClass"], "routeNumber": road["routeNumber"], "jurisdiction": road["jurisdiction"],
    }
    n13_feature = {
        "type": "Feature",
        "properties": {
            **common_properties, "geometrySource": "n13",
            "source": ["MLIT National Land Numerical Information N13 2024"],
            "license": "N13 source terms apply", "confidence": "medium",
            "note": "Identity comes from the road registry and OSM reference; display geometry is selected from N13.",
            "match": {"candidateCount": len(candidates), "selectedFeatureCount": len(selected), "osmCoveragePercent": round(coverage, 2)},
        },
        "geometry": mapping(selected_wgs84.geometry.union_all()),
    }
    osm_feature = {
        "type": "Feature", "properties": {
            **common_properties, "geometrySource": "osm", "source": ["OpenStreetMap"],
            "license": "ODbL 1.0", "confidence": "high",
            "note": "OSM reference geometry used to identify and validate the canonical road.",
        }, "geometry": mapping(osm.to_crs("EPSG:4326").geometry.union_all()),
    }
    n13_output = PUBLIC_ROADS / f"{road['id']}-n13.geojson"
    osm_output = PUBLIC_ROADS / f"{road['id']}-osm.geojson"
    n13_output.parent.mkdir(parents=True, exist_ok=True)
    n13_output.write_text(json.dumps({"type": "FeatureCollection", "features": [n13_feature]}, ensure_ascii=False, separators=(",", ":")) + "\n")
    osm_output.write_text(json.dumps({"type": "FeatureCollection", "features": [osm_feature]}, ensure_ascii=False, separators=(",", ":")) + "\n")
    rebuild_search_index(args.registry)
    report = {
        "roadId": road["id"], "n13CandidateCount": len(candidates), "selectedFeatureCount": len(selected),
        "osmReferenceCoveragePercent": round(coverage, 3),
        "selectedResidualMeters": {
            field: {"min": round(float(selected[field].min()), 3), "median": round(float(selected[field].median()), 3), "p90": round(float(selected[field].quantile(.9)), 3), "max": round(float(selected[field].max()), 3)}
            for field in ("match_min_m", "match_median_m", "match_p90_m")
        },
        "candidateDistributions": {field: dict(Counter(candidates[field].astype(str))) for field in ("N13_002", "N13_004", "N13_006")},
        "matchingThresholds": match, "unresolvedSections": unresolved,
        "outputBytes": {"n13": n13_output.stat().st_size, "osm": osm_output.stat().st_size},
        "outputs": {"n13": str(n13_output), "osm": str(osm_output)},
    }
    (PUBLIC_ROADS / f"{road['id']}.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
