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
from shapely.geometry import LineString, MultiLineString, Point, mapping

REGISTRY = Path("data/roads/registry.json")
N13_INPUT = Path("data/fixtures/n13-shinjuku.geojson")
CACHE = Path("data/cache/roads")
PUBLIC_ROADS = Path("public/data/roads")
SEARCH_INDEX = Path("public/search/roads.json")
METRIC_CRS = "EPSG:6677"
STUDY_BBOX = (139.6000, 35.6500, 139.7800, 35.7200)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_ENDPOINT_SNAP_METERS = 2.0


def _line_parts(geometries) -> list[LineString]:
    """Flatten line-like N13 features without changing their vertices."""
    parts = []
    for geometry in geometries:
        if geometry.geom_type == "LineString":
            parts.append(geometry)
        elif geometry.geom_type == "MultiLineString":
            parts.extend(geometry.geoms)
        else:
            raise ValueError(f"N13 display input must be line geometry, not {geometry.geom_type}")
    return [part for part in parts if not part.is_empty and len(part.coords) > 1]


def _reference_position(point, reference) -> tuple[int, float, float]:
    parts = list(reference.geoms) if reference.geom_type == "MultiLineString" else [reference]
    index, part = min(enumerate(parts), key=lambda item: item[1].distance(point))
    return index, part.project(point), part.distance(point)


def build_display_chains(selected_n13, osm_reference, config: dict | None = None):
    """Snap tiny endpoint gaps and form inspectable, source-aligned display chains.

    At a junction, incident ends are paired greedily by (1) opposite progression
    along the same OSM part, (2) smallest turn, then (3) OSM proximity.  Turns
    above 60 degrees are left unresolved.  This deliberately does not conflate
    nearby parallel lines: only endpoints in the same small snap cluster can join.
    """
    config = config or {}
    tolerance = float(config.get("endpointSnapMeters", DEFAULT_ENDPOINT_SNAP_METERS))
    parts = _line_parts(selected_n13.geometry if hasattr(selected_n13, "geometry") else selected_n13)
    original = MultiLineString([list(part.coords) for part in parts])

    # Conservative complete-link clustering prevents a chain of 2 m gaps from
    # moving endpoints that were much farther than the configured tolerance.
    endpoints = [(i, end, part.coords[end]) for i, part in enumerate(parts) for end in (0, -1)]
    clusters: list[list[tuple[int, int, tuple]]] = []
    for endpoint in endpoints:
        point = Point(endpoint[2])
        cluster = next((c for c in clusters if all(point.distance(Point(e[2])) <= tolerance for e in c)), None)
        if cluster is None:
            clusters.append([endpoint])
        else:
            cluster.append(endpoint)
    snapped = [list(part.coords) for part in parts]
    node_for: dict[tuple[int, int], int] = {}
    snap_gaps = []
    for node, cluster in enumerate(clusters):
        x = sum(e[2][0] for e in cluster) / len(cluster)
        y = sum(e[2][1] for e in cluster) / len(cluster)
        for edge, end, coordinate in cluster:
            node_for[(edge, end)] = node
            snapped[edge][end] = (x, y)
        if len(cluster) > 1:
            snap_gaps.extend(Point(cluster[i][2]).distance(Point(cluster[j][2]))
                             for i in range(len(cluster)) for j in range(i + 1, len(cluster)))

    incident: dict[int, list[tuple[int, int]]] = {}
    for end, node in node_for.items():
        incident.setdefault(node, []).append(end)
    paired: dict[tuple[int, int], tuple[int, int]] = {}
    for ends in incident.values():
        choices = []
        for ai, a in enumerate(ends):
            for b in ends[ai + 1:]:
                if a[0] == b[0]:
                    continue
                ac = snapped[a[0]]; bc = snapped[b[0]]
                av = np.asarray(ac[1] if a[1] == 0 else ac[-2]) - np.asarray(ac[a[1]])
                bv = np.asarray(bc[1] if b[1] == 0 else bc[-2]) - np.asarray(bc[b[1]])
                cosine = float(np.dot(av, bv) / (np.linalg.norm(av) * np.linalg.norm(bv)))
                turn = float(np.degrees(np.arccos(np.clip(-cosine, -1, 1))))
                ap0 = _reference_position(Point(ac[a[1]]), osm_reference)
                ap1 = _reference_position(Point(ac[1] if a[1] == 0 else ac[-2]), osm_reference)
                bp1 = _reference_position(Point(bc[1] if b[1] == 0 else bc[-2]), osm_reference)
                progresses_oppositely = ap0[0] == ap1[0] == bp1[0] and (ap1[1] - ap0[1]) * (bp1[1] - ap0[1]) < 0
                choices.append(((0 if progresses_oppositely else 1, turn, ap1[2] + bp1[2]), a, b))
        for score, a, b in sorted(choices):
            if a not in paired and b not in paired and score[1] <= 60:
                paired[a] = b; paired[b] = a

    # Walk the endpoint pairing graph; each source edge is consumed exactly once.
    chains, used = [], set()
    starts = [(i, end) for i in range(len(parts)) for end in (0, -1) if (i, end) not in paired]
    starts += [(i, 0) for i in range(len(parts))]
    for start in starts:
        if start[0] in used:
            continue
        coordinates, current = [], start
        while current[0] not in used:
            edge, enter = current; used.add(edge)
            coords = snapped[edge] if enter == 0 else list(reversed(snapped[edge]))
            coordinates.extend(coords if not coordinates else coords[1:])
            leave = (edge, -1 if enter == 0 else 0)
            if leave not in paired:
                break
            current = paired[leave]
        chains.append(LineString(coordinates))

    display = chains[0] if len(chains) == 1 else MultiLineString(chains)
    if display.hausdorff_distance(original) > tolerance + 1e-6:
        raise RuntimeError("Display stitching moved N13 geometry beyond endpointSnapMeters")
    source_residual = max((max(distances(part, osm_reference, 5), default=0) for part in parts), default=0)
    display_residual = max((max(distances(chain, osm_reference, 5), default=0) for chain in chains), default=0)
    if display_residual > source_residual + tolerance + 1e-6:
        raise RuntimeError("Display stitching introduced geometry farther from the OSM reference")
    diagnostics = {
        "sourceSegmentCount": len(parts), "displayChainCount": len(chains),
        "sourceLengthMeters": round(original.length, 3), "stitchedLengthMeters": round(display.length, 3),
        "endpointSnapCount": sum(len(cluster) - 1 for cluster in clusters
                                 if len(cluster) > 1 and any(Point(a[2]).distance(Point(b[2])) > 1e-9
                                                             for a in cluster for b in cluster)),
        "maximumSnappedGapMeters": round(max(snap_gaps, default=0), 3),
        "unresolvedBreakCount": sum(1 for ends in incident.values() if len(ends) > 1 for end in ends if end not in paired),
        "maximumSourceResidualMeters": round(source_residual, 3),
        "maximumDisplayResidualMeters": round(display_residual, 3),
    }
    return display, diagnostics


def load_road(registry_path: Path, road_id: str) -> dict:
    registry = json.loads(registry_path.read_text())
    roads = registry["roads"]
    try:
        road = next(road for road in roads if road["id"] == road_id)
        return {**road, "display": {**registry.get("display", {}), **road.get("display", {})}}
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
    display_config = road.get("display", {"endpointSnapMeters": DEFAULT_ENDPOINT_SNAP_METERS})
    display_geometry, stitching = build_display_chains(selected, reference, display_config)
    display_wgs84 = gpd.GeoSeries([display_geometry], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]
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
            "note": "Identity comes from the road registry and OSM reference; display geometry is stitched from selected N13 segments.",
            "match": {"candidateCount": len(candidates), "selectedFeatureCount": len(selected), "osmCoveragePercent": round(coverage, 2)},
            "geometryProcessing": {"source": "MLIT N13", "display": "endpoint-snapped and line-merged", **stitching,
                                   "endpointSnapMeters": float(display_config["endpointSnapMeters"])},
        },
        "geometry": mapping(display_wgs84),
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
    n13_payload = json.dumps({"type": "FeatureCollection", "features": [n13_feature]}, ensure_ascii=False, separators=(",", ":")) + "\n"
    source_geometry = selected.to_crs("EPSG:4326").geometry.union_all()
    unstitched_feature = {**n13_feature, "geometry": mapping(source_geometry)}
    unstitched_bytes = len((json.dumps({"type": "FeatureCollection", "features": [unstitched_feature]},
                                      ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    n13_output.write_text(n13_payload)
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
        "geometryProcessing": {**stitching, "endpointSnapMeters": float(display_config["endpointSnapMeters"])},
        "outputBytes": {"n13BeforeStitching": unstitched_bytes, "n13AfterStitching": n13_output.stat().st_size,
                        "n13": n13_output.stat().st_size, "osm": osm_output.stat().st_size},
        "outputs": {"n13": str(n13_output), "osm": str(osm_output)},
    }
    (PUBLIC_ROADS / f"{road['id']}.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
