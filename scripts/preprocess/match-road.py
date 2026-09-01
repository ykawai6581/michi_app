"""Build one canonical road's display geometry from the road registry and N13."""

from __future__ import annotations

import argparse
import json
import math
import time
import warnings
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString, MultiLineString, Point, box, mapping
from shapely.ops import linemerge, substring, unary_union

REGISTRY = Path("data/roads/registry.json")
SOURCE_CONFIG = Path("data/roads/sources.json")
PUBLIC_ROADS = Path("public/data/roads")
SEARCH_INDEX = Path("public/search/roads.json")
METRIC_CRS = "EPSG:6677"
DEFAULT_EXCLUDE_NAME_TAGS = ("name", "name:ja", "name:en", "alt_name")
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_ENDPOINT_SNAP_METERS = 2.0
DEFAULT_NETWORK_SELECTION = {
    "endpointSnapMeters": DEFAULT_ENDPOINT_SNAP_METERS,
    "progressSampleMeters": 5.0,
    "minimumProgressRatio": 0.35,
    "minimumChainageMonotonicity": 0.7,
    "maximumOrientationMismatchDegrees": 55.0,
    "maximumSampleDistanceMeters": 35.0,
    "unmatchedSampleCost": 45.0,
    "edgeSwitchCost": 6.0,
    "disconnectedTransitionCost": 250.0,
    "maximumTransitionPathMeters": 120.0,
    "maximumGapConnectorMeters": 300.0,
    "maximumGapDetourRatio": 3.0,
    "orientationCostWeight": 0.2,
    "progressCostWeight": 8.0,
    "monotonicityCostWeight": 8.0,
    # Reference-sample ownership is intentionally configured independently of
    # the old edge-network scoring knobs retained above for registry backwards
    # compatibility.
    "classPriority": None,
    "minimumOwnedReferenceSamples": 3,
    "ownershipTransitionSamples": 1,
    "maximumOwnershipBridgeSamples": 2,
    "maximumJunctionExtensionMeters": 35.0,
    "ownershipContinuityIterations": 4,
    # Separate OSM parts may be the two sides of a divided road.  A sustained
    # cross-class match across nearby, parallel parts is competition for the
    # same route interval, not evidence for another carriageway.
    "crossClassParallelSearchMeters": 50.0,
    "crossClassParallelMinimumSamples": 6,
    "continuityMaximumIntermediateFeatures": 2,
    "continuityReferenceWindowBufferMeters": 10.0,
    "useSpatialIndex": True,
}
OSM_CACHE_BOUNDS_EPSILON = 1e-7


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
        "parallelCarriagewaysCollapsed": False,
    }
    return display, diagnostics


def load_road(registry_path: Path, road_id: str) -> dict:
    registry = json.loads(registry_path.read_text())
    roads = registry["roads"]
    try:
        road = next(road for road in roads if road["id"] == road_id)
        road = {**road, "display": {**registry.get("display", {}), **road.get("display", {})}}
        # A narrow compatibility shim for registries produced before entityType/reference.
        road.setdefault("entityType", "statutory-road")
        if "reference" not in road and "osm" in road:
            road["reference"] = {"type": "osm-ref", **road["osm"]}
        n13 = road.setdefault("n13", {})
        if "classifications" not in n13 and "classification" in n13:
            n13["classifications"] = [n13["classification"]]
        return road
    except StopIteration as error:
        raise RuntimeError(f"Unknown road id {road_id!r}; add it to {registry_path}") from error


def osm_query(road: dict, bounds: list[float], direct_fallback: bool = False) -> str:
    west, south, east, north = bounds
    reference = road["reference"]
    if reference["type"] == "osm-name":
        filters = []
        for tag in reference.get("tags", ["name", "name:ja", "alt_name"]):
            for name in reference["names"]:
                filters.append(f'way["highway"]["{tag}"="{name.replace(chr(34), r"\"")}"]({south},{west},{north},{east});')
        return "[out:json][timeout:180];\n(" + "\n".join(filters) + "\n);\nout tags geom;"
    ref = reference["ref"].replace('"', '\\"')
    network = reference.get("network")
    escaped_network = str(network).replace('"', '\\"') if network else ""
    if network and direct_fallback:
        return f'''[out:json][timeout:180];
way["highway"]["ref"="{ref}"]["network"="{escaped_network}"]({south},{west},{north},{east});
out tags geom;'''
    network_filter = f'["network"="{escaped_network}"]' if network else ""
    if not network:
        warnings.warn(
            f"Statutory road reference uses ref={reference['ref']} without a network; "
            "same-number roads from other networks may be included.", UserWarning, stacklevel=2)
        return f'''[out:json][timeout:180];
relation["type"="route"]["route"="road"]["ref"="{ref}"]({south},{west},{north},{east})->.r;
way["highway"]["ref"="{ref}"]({south},{west},{north},{east})->.w;
way(r.r)({south},{west},{north},{east})->.rw;
(.w;.rw;);
out tags geom;'''
    return f'''[out:json][timeout:180];
relation["type"="route"]["route"="road"]["ref"="{ref}"]{network_filter}({south},{west},{north},{east})->.r;
way(r.r)({south},{west},{north},{east})->.rw;
.rw out tags geom;'''


def download_reference(road: dict, output: Path, endpoint: str, bounds: list[float]) -> None:
    def request_elements(direct_fallback: bool = False) -> list[dict]:
        request = Request(f"{endpoint}?{urlencode({'data': osm_query(road, bounds, direct_fallback)})}", headers={
            "Accept": "application/json", "User-Agent": "michi-map-road-matcher/0.1",
        })
        with urlopen(request, timeout=210) as response:  # noqa: S310
            return json.load(response)["elements"]

    elements = request_elements()
    reference = road["reference"]
    if not elements and reference["type"] == "osm-ref" and reference.get("network"):
        elements = request_elements(direct_fallback=True)
        if not elements:
            raise RuntimeError(
                f"OSM has neither a matching route relation nor directly tagged highway ways for "
                f"ref={reference['ref']}, network={reference['network']} ({road['id']})")
    features = [{
        "type": "Feature",
        "properties": {"osm_way_id": item["id"], **item.get("tags", {}),
                       "osm_reference_ref": reference.get("ref"),
                       "osm_reference_network": reference.get("network")},
        "geometry": {"type": "LineString", "coordinates": [[p["lon"], p["lat"]] for p in item["geometry"]]},
    } for item in elements if len(item.get("geometry", [])) > 1]
    if not features:
        raise RuntimeError(f"OSM returned no reference geometry for {road['id']}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}) + "\n")


def load_source_config(path: Path) -> dict:
    if not path.exists():
        raise RuntimeError(f"Source configuration not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_n13_manifest(source: Path) -> tuple[Path, dict]:
    """Return the normalized cache root and its source-coverage manifest."""
    root = source.with_suffix("") if source.suffix.lower() in (".parquet", ".geoparquet") else source
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError(f"N13 coverage metadata not found: {manifest_path}; rerun preprocess-n13.py")
    manifest = json.loads(manifest_path.read_text())
    bounds = manifest.get("boundsWgs84")
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise RuntimeError(f"N13 manifest has invalid boundsWgs84: {manifest_path}")
    return root, manifest


def _bounds_cover(outer: list[float], inner: list[float]) -> bool:
    return (outer[0] <= inner[0] + OSM_CACHE_BOUNDS_EPSILON
            and outer[1] <= inner[1] + OSM_CACHE_BOUNDS_EPSILON
            and outer[2] >= inner[2] - OSM_CACHE_BOUNDS_EPSILON
            and outer[3] >= inner[3] - OSM_CACHE_BOUNDS_EPSILON)


def reference_cache_identity(reference: dict) -> dict:
    """Return acquisition identity; display-time member exclusions are deliberately absent."""
    return {key: reference.get(key) for key in ("type", "ref", "network")
            if reference.get(key) is not None}


def clip_osm_to_bounds(frame: gpd.GeoDataFrame, bounds: list[float]) -> gpd.GeoDataFrame:
    """Clip any OSM provider result to the N13 source coverage."""
    if frame.crs is None:
        frame = frame.set_crs("EPSG:4326")
    original_crs = frame.crs
    wgs84 = frame.to_crs("EPSG:4326")
    clipped = wgs84.copy()
    clipped.geometry = clipped.geometry.intersection(box(*bounds))
    clipped = clipped[~clipped.geometry.is_empty & clipped.geometry.notna()].copy()
    return clipped.to_crs(original_crs)


def _local_osm_reference(road: dict, source: Path) -> gpd.GeoDataFrame:
    """Read matching ways from a regional GIS source; PBF requires GDAL OSM support."""
    try:
        frame = gpd.read_file(source, layer="lines") if source.suffix == ".pbf" else gpd.read_file(source)
    except Exception as error:
        raise RuntimeError(f"Cannot read local OSM source {source}: {error}") from error
    reference = road["reference"]
    if reference["type"] == "osm-ref":
        if "ref" not in frame:
            raise RuntimeError(f"Local OSM source {source} has no ref field")
        ref = str(reference["ref"])
        refs = frame["ref"].fillna("").astype(str).str.split(";")
        frame = frame[refs.apply(lambda values: ref in [value.strip() for value in values])].copy()
        network = reference.get("network")
        if network:
            if "network" not in frame:
                raise RuntimeError(
                    f"Local OSM lines source {source} cannot establish exact network={network}; "
                    "falling through to Overpass is required")
            frame = frame[frame["network"].fillna("").astype(str) == str(network)].copy()
    else:
        names, tags = set(reference["names"]), reference.get("tags", ["name", "name:ja", "alt_name"])
        masks = [(frame[tag].fillna("").astype(str).str.split(";").apply(
            lambda values: bool(names.intersection(value.strip() for value in values))))
                 for tag in tags if tag in frame]
        if not masks:
            raise RuntimeError(f"Local OSM source {source} has none of the configured name fields")
        mask = masks[0]
        for extra in masks[1:]:
            mask |= extra
        frame = frame[mask].copy()
    include = set(map(str, reference.get("includeIds", [])))
    exclude = set(map(str, reference.get("excludeIds", [])))
    if include and "osm_way_id" in frame:
        frame = frame[frame["osm_way_id"].astype(str).isin(include)]
    if exclude and "osm_way_id" in frame:
        frame = frame[~frame["osm_way_id"].astype(str).isin(exclude)]
    if frame.empty:
        raise RuntimeError(f"Local OSM source {source} contains no ways for {road['id']}")
    return frame


def build_osm_reference(road: dict, source_config: dict, coverage_bounds: list[float] | None = None,
                        refresh: bool = False, endpoint_override: str | None = None) -> tuple[gpd.GeoDataFrame, dict]:
    """Resolve a reference from cache, regional source, or configured Overpass fallback."""
    config = source_config["osm"]
    cache = Path(config["cacheDirectory"]) / f"{road['id']}-osm.geojson"
    metadata = cache.with_suffix(".meta.json")
    if coverage_bounds is None:
        coverage_bounds = config.get("overpass", {}).get("boundsByJurisdiction", {}).get(road.get("jurisdiction"))
        if not coverage_bounds:
            raise RuntimeError("N13 coverage bounds are required (legacy jurisdiction fallback is unavailable)")
    identity = reference_cache_identity(road["reference"])
    if cache.exists() and not refresh:
        cached = json.loads(metadata.read_text()) if metadata.exists() else {}
        cached_bounds = cached.get("coverageBoundsWgs84")
        if (cached_bounds and cached.get("referenceIdentity") == identity
                and _bounds_cover(cached_bounds, coverage_bounds)):
            frame = clip_osm_to_bounds(gpd.read_file(cache), coverage_bounds)
            return frame, {"provider": "cache", "path": str(cache),
                           "cachedCoverageBoundsWgs84": cached_bounds, "workingBoundsWgs84": coverage_bounds}
    provider = config.get("provider", "auto")
    local = Path(config.get("local", {}).get("path", ""))
    if provider in ("auto", "local") and local.is_file():
        try:
            frame = _local_osm_reference(road, local)
            frame = clip_osm_to_bounds(frame, coverage_bounds)
            if frame.empty:
                raise RuntimeError(f"Local OSM source contains no reference inside N13 coverage for {road['id']}")
            cache.parent.mkdir(parents=True, exist_ok=True)
            frame.to_file(cache, driver="GeoJSON")
            metadata.write_text(json.dumps({"coverageBoundsWgs84": coverage_bounds,
                                            "referenceIdentity": identity}, indent=2) + "\n")
            return frame, {"provider": "local", "path": str(local), "cache": str(cache),
                           "workingBoundsWgs84": coverage_bounds}
        except RuntimeError:
            if provider == "local":
                raise
    if provider == "local":
        raise RuntimeError(f"Configured local OSM source does not exist: {local}")
    overpass = config["overpass"]
    download_reference(road, cache, endpoint_override or overpass.get("endpoint", OVERPASS_URL), coverage_bounds)
    metadata.write_text(json.dumps({"coverageBoundsWgs84": coverage_bounds,
                                    "referenceIdentity": identity}, indent=2) + "\n")
    frame = clip_osm_to_bounds(gpd.read_file(cache), coverage_bounds)
    return frame, {"provider": "overpass", "bounds": coverage_bounds, "cache": str(cache),
                   "workingBoundsWgs84": coverage_bounds}


def filter_reference_members(entity: dict, source: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """Split reference members using exact, semicolon-tokenized OSM names."""
    excluded_names = set(map(str, entity["reference"].get("excludeNames", [])))
    if not excluded_names:
        return source.copy(), source.iloc[0:0].copy()
    tags = entity["reference"].get("excludeNameTags", DEFAULT_EXCLUDE_NAME_TAGS)
    masks = [source[tag].fillna("").astype(str).str.split(";").apply(
        lambda values: bool(excluded_names.intersection(value.strip() for value in values)))
             for tag in tags if tag in source]
    if not masks:
        return source.copy(), source.iloc[0:0].copy()
    mask = masks[0]
    for extra in masks[1:]:
        mask |= extra
    return source[~mask].copy(), source[mask].copy()


def build_reference(entity: dict, osm_source: gpd.GeoDataFrame) -> tuple[object, dict]:
    """Build a filtered matcher reference and report disconnected OSM ambiguity."""
    config = entity["reference"]
    source = osm_source.copy()
    if config["type"] == "osm-name":
        names = set(config["names"])
        masks = [source[tag].fillna("").astype(str).str.split(";").apply(
            lambda values: bool(names.intersection(value.strip() for value in values)))
                 for tag in config.get("tags", ["name", "name:ja", "alt_name"]) if tag in source]
        if not masks:
            raise RuntimeError("OSM source has none of the configured exact-name fields")
        mask = masks[0]
        for extra in masks[1:]:
            mask |= extra
        source = source[mask].copy()
    elif ("osm_reference_ref" in source
          and source["osm_reference_ref"].fillna("").astype(str).eq(str(config["ref"])).all()
          and (not config.get("network") or ("osm_reference_network" in source
               and source["osm_reference_network"].fillna("").astype(str).eq(str(config["network"])).all()))):
        # Overpass acquisition already established relation/direct-way identity;
        # member ways are not required to duplicate their parent relation's ref.
        pass
    elif "ref" in source:
        wanted = str(config["ref"])
        source = source[source["ref"].fillna("").astype(str).str.split(";").apply(
            lambda values: wanted in (value.strip() for value in values))].copy()
    else:
        raise RuntimeError("OSM source has no ref field for statutory-road reference")
    identifier = "osm_way_id" if "osm_way_id" in source else None
    if identifier:
        include = set(map(str, config.get("includeIds", [])))
        exclude = set(map(str, config.get("excludeIds", [])))
        if include:
            source = source[source[identifier].astype(str).isin(include)]
        if exclude:
            source = source[~source[identifier].astype(str).isin(exclude)]
    member_count = len(source)
    if not member_count:
        raise RuntimeError(f"OSM source contains no exact reference geometry for {entity['id']}")
    source, excluded_members = filter_reference_members(entity, source)
    if source.empty:
        raise RuntimeError(f"OSM member-name exclusions removed all reference geometry for {entity['id']}")
    if source.crs is None:
        source = source.set_crs("EPSG:4326")
    metric = source.to_crs(METRIC_CRS)
    geometries = list(metric.geometry.dropna())
    reference = unary_union(geometries)
    parts = _line_parts([reference])
    # Connectivity is diagnostic only: never add synthetic lines between components.
    groups: list[list[LineString]] = []
    for part in parts:
        touching = [group for group in groups if any(part.distance(other) <= .01 for other in group)]
        if not touching:
            groups.append([part])
        else:
            merged = [part]
            for group in touching:
                merged.extend(group); groups.remove(group)
            groups.append(merged)
    component_lengths = sorted((sum(part.length for part in group) for group in groups), reverse=True)
    return reference, {
        "type": config["type"], "wayCount": len(source), "memberWayCount": member_count,
        "excludedByExactNameCount": len(excluded_members),
        "excludedNames": list(config.get("excludeNames", [])),
        "statutoryRelation": ({"network": config.get("network"), "ref": config.get("ref")}
                              if config["type"] == "osm-ref" else None),
        "connectedComponentCount": len(groups),
        "componentLengthsMeters": [round(length, 1) for length in component_lengths],
        "ambiguousDisconnectedReference": len(groups) > 1,
        "syntheticBridgesAdded": 0,
    }


def load_n13_candidates(road: dict, source: Path, reference=None) -> gpd.GeoDataFrame:
    """Read requested partitions, using their bbox columns before residual testing."""
    legacy_root = source.with_suffix("") if source.suffix.lower() in (".parquet", ".geoparquet") else source
    if legacy_root != source and legacy_root.is_dir():
        source = legacy_root
    if not source.exists():
        raise RuntimeError(f"N13 cache not found: {source}; run preprocess-n13.py first")
    road_classes = [str(value) for value in road["n13"]["classifications"]]
    frames = []
    diagnostics = {}
    corridor = None
    filter_bounds = None
    if reference is not None:
        matching = road.get("matching", {})
        ownership_distance = float(road.get("networkSelection", {}).get(
            "maximumSampleDistanceMeters", DEFAULT_NETWORK_SELECTION["maximumSampleDistanceMeters"]))
        derived_shortlist = ownership_distance + float(matching.get("shortlistSafetyMarginMeters", 5))
        corridor_meters = max(ownership_distance, float(matching.get("spatialShortlistMeters", derived_shortlist)))
        corridor = reference.buffer(corridor_meters)
        filter_bounds = gpd.GeoSeries([corridor], crs=METRIC_CRS).to_crs("EPSG:4326").total_bounds
    for road_class in road_classes:
        partition = source / f"class={road_class}" / "roads.parquet" if source.is_dir() else source
        if not partition.exists():
            raise RuntimeError(f"N13 class {road_class} cache not found: {partition}; rebuild it with --classes {road_class}")
        partition_count = None
        filters = None
        if filter_bounds is not None:
            west, south, east, north = filter_bounds
            filters = [("bbox_east", ">=", west), ("bbox_north", ">=", south),
                       ("bbox_west", "<=", east), ("bbox_south", "<=", north)]
        if partition.suffix.lower() in (".parquet", ".geoparquet"):
            try:
                import pyarrow.parquet as pq
                parquet = pq.ParquetFile(partition)
                partition_count = parquet.metadata.num_rows
                has_bbox_columns = {"bbox_west", "bbox_south", "bbox_east", "bbox_north"}.issubset(
                    parquet.schema_arrow.names)
                frame = gpd.read_parquet(partition, filters=filters) if filters and has_bbox_columns else gpd.read_parquet(partition)
            except (ImportError, KeyError, TypeError):
                # Legacy Task A caches have no bbox columns; remain readable but should be regenerated.
                frame = gpd.read_parquet(partition)
        else:
            frame = gpd.read_file(partition)
            partition_count = len(frame)
        if frame.crs is None:
            frame = frame.set_crs("EPSG:6668")
        frame = frame[frame["N13_003"].astype(str) == road_class].copy().to_crs(METRIC_CRS)
        pushdown_count = len(frame)
        if corridor is not None and not frame.empty:
            frame = frame[frame.geometry.intersects(corridor)].copy()
        diagnostics[road_class] = {
            "partitionFeatureCount": partition_count if partition_count is not None else pushdown_count,
            "bboxReadCount": pushdown_count,
            "spatiallyShortlistedCount": len(frame),
            "residualTestedCount": len(frame),
        }
        frames.append(frame)
    result = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=METRIC_CRS)
    result.attrs["classDiagnostics"] = diagnostics
    return result


def match_n13(candidates: gpd.GeoDataFrame, reference, road: dict):
    match = road["matching"]
    if candidates.empty:
        empty = candidates.copy()
        for field in ("match_min_m", "match_median_m", "match_p90_m"):
            empty[field] = pd.Series(dtype=float)
        return empty, empty
    diagnostics = []
    for geometry in candidates.geometry:
        sampled = distances(geometry, reference, match["sampleIntervalMeters"])
        diagnostics.append((geometry.distance(reference), np.median(sampled), np.percentile(sampled, 90)))
    candidates = candidates.copy()
    candidates[["match_min_m", "match_median_m", "match_p90_m"]] = np.round(diagnostics, 3)
    selected = candidates[(candidates["match_median_m"] <= match["maximumMedianResidualMeters"])
                          & (candidates["match_p90_m"] <= match["maximumP90ResidualMeters"])].copy()
    return selected, candidates


def _ordered_reference_parts(reference) -> list[LineString]:
    """Return independent ordered reference components, without adding bridges."""
    merged = linemerge(reference) if reference.geom_type == "MultiLineString" else reference
    return _line_parts([merged])


def _angle_difference(a: np.ndarray, b: np.ndarray) -> float:
    denominator = np.linalg.norm(a) * np.linalg.norm(b)
    if denominator <= 1e-9:
        return 90.0
    angle = math.degrees(math.acos(float(np.clip(abs(np.dot(a, b) / denominator), -1, 1))))
    return min(angle, 180 - angle)


def _local_orientation(line: LineString, point: Point, interval: float) -> np.ndarray:
    position = line.project(point)
    epsilon = min(max(interval / 2, .5), max(line.length / 2, .5))
    before = line.interpolate(max(0, position - epsilon))
    after = line.interpolate(min(line.length, position + epsilon))
    return np.asarray(after.coords[0]) - np.asarray(before.coords[0])


def _sample_reference(part: LineString, interval: float) -> tuple[np.ndarray, list[Point]]:
    offsets = np.unique(np.append(np.arange(0, part.length, interval), part.length))
    return offsets, [part.interpolate(float(offset)) for offset in offsets]


def _ownership_runs(owners: list[int | None]) -> list[dict]:
    """Group an ownership sequence; unmatched samples remain explicit gaps."""
    runs = []
    index = 0
    while index < len(owners):
        edge = owners[index]
        end = index + 1
        while end < len(owners) and owners[end] == edge:
            end += 1
        if edge is not None:
            runs.append({"edge": edge, "start": index, "end": end})
        index = end
    return runs


def _source_junctions(first: LineString, second: LineString, tolerance: float) -> list[tuple[float, float]]:
    """Return endpoint-to-line-interior junction positions on complete atoms."""
    junctions = []
    for distance, coordinate in ((0.0, first.coords[0]), (first.length, first.coords[-1])):
        point = Point(coordinate)
        if point.distance(second) <= tolerance:
            junctions.append((distance, float(second.project(point))))
    for distance, coordinate in ((0.0, second.coords[0]), (second.length, second.coords[-1])):
        point = Point(coordinate)
        if point.distance(first) <= tolerance:
            junctions.append((float(first.project(point)), distance))
    return list(dict.fromkeys((round(a, 9), round(b, 9)) for a, b in junctions))


def _neighbor_runs(runs: list[dict], index: int, maximum_gap: int) -> tuple[dict | None, dict | None]:
    previous = runs[index - 1] if index else None
    following = runs[index + 1] if index + 1 < len(runs) else None
    if previous and runs[index]["start"] - previous["end"] > maximum_gap:
        previous = None
    if following and following["start"] - runs[index]["end"] > maximum_gap:
        following = None
    return previous, following


def select_reference_network(stage1: gpd.GeoDataFrame, reference, config: dict | None = None):
    """Select exact N13 substrings justified by OSM samples, then restore source junctions."""
    started = time.perf_counter()
    settings = {**DEFAULT_NETWORK_SELECTION, **(config or {})}
    if stage1.empty:
        return stage1.copy(), stage1.copy(), {}
    source = stage1.copy()
    source["_ownershipSourceFeatureIndex"] = (source["sourceFeatureIndex"] if "sourceFeatureIndex" in source
                                               else source.index)
    exploded = source.explode(index_parts=True)
    atom_indices = (exploded.index.get_level_values(-1).to_numpy()
                    if isinstance(exploded.index, pd.MultiIndex) else np.zeros(len(exploded), dtype=int))
    frame = exploded.reset_index(drop=True)
    frame["sourceFeatureIndex"] = frame.pop("_ownershipSourceFeatureIndex")
    if "sourceAtomIndex" not in frame:
        frame["sourceAtomIndex"] = atom_indices
    parts = _ordered_reference_parts(reference)
    interval = float(settings["progressSampleMeters"])
    maximum_distance = float(settings["maximumSampleDistanceMeters"])
    maximum_angle = float(settings["maximumOrientationMismatchDegrees"])
    minimum_run = int(settings["minimumOwnedReferenceSamples"])
    maximum_bridge = int(settings["maximumOwnershipBridgeSamples"])
    tolerance = float(settings["endpointSnapMeters"])
    classes = ([str(value) for value in settings["classPriority"]] if settings.get("classPriority")
               else list(dict.fromkeys(frame.N13_003.astype(str))))
    rank = {road_class: index for index, road_class in enumerate(classes)}
    samples_by_part = [_sample_reference(part, interval) for part in parts]
    owners = [[None] * len(points) for _, points in samples_by_part]
    reassigned_from = [[None] * len(points) for _, points in samples_by_part]
    cross_class_parallel_rejections = 0
    geometries = list(frame.geometry)
    edge_classes = frame.N13_003.astype(str).tolist()
    source_feature_indices = frame.sourceFeatureIndex.tolist()
    class_edges = {road_class: [edge for edge, value in enumerate(edge_classes) if value == road_class]
                   for road_class in classes}
    class_spatial_indexes = ({road_class: gpd.GeoSeries([geometries[edge] for edge in edges], crs=frame.crs).sindex
                              for road_class, edges in class_edges.items()}
                             if bool(settings["useSpatialIndex"]) else {})
    reference_vectors = [[_local_orientation(part, sample, interval) for sample in samples]
                         for part, (_, samples) in zip(parts, samples_by_part)]
    candidate_cache = {}
    candidate_comparisons = 0
    candidates_per_sample = Counter()
    junction_cache = {}

    def junctions(first_edge, second_edge):
        key = (first_edge, second_edge)
        if key not in junction_cache:
            junction_cache[key] = _source_junctions(geometries[first_edge], geometries[second_edge], tolerance)
            junction_cache[(second_edge, first_edge)] = [(second, first) for first, second in junction_cache[key]]
        return junction_cache[key]

    def candidates(part_index, sample_index, road_class=None, excluded=frozenset()):
        nonlocal candidate_comparisons
        if road_class is None:
            combined = [choice for value in classes
                        for choice in candidates(part_index, sample_index, value, excluded)]
            return sorted(combined)
        cache_key = (part_index, sample_index, road_class)
        if cache_key in candidate_cache:
            return [choice for choice in candidate_cache[cache_key] if choice[2] not in excluded]
        sample = samples_by_part[part_index][1][sample_index]
        reference_vector = reference_vectors[part_index][sample_index]
        choices = []
        query_bounds = box(sample.x - maximum_distance, sample.y - maximum_distance,
                           sample.x + maximum_distance, sample.y + maximum_distance)
        edges = class_edges.get(road_class, [])
        nearby = ([edges[position] for position in map(int, class_spatial_indexes[road_class].query(query_bounds))]
                  if road_class in class_spatial_indexes else edges)
        candidates_per_sample[(part_index, sample_index)] += len(nearby)
        for edge in nearby:
            candidate_comparisons += 1
            distance = float(geometries[edge].distance(sample))
            if distance > maximum_distance:
                continue
            mismatch = _angle_difference(_local_orientation(geometries[edge], sample, interval), reference_vector)
            if mismatch <= maximum_angle:
                choices.append((rank.get(edge_classes[edge], len(rank)),
                                distance + mismatch * float(settings["orientationCostWeight"]), edge))
        candidate_cache[cache_key] = sorted(choices)
        return [choice for choice in candidate_cache[cache_key] if choice[2] not in excluded]

    # Hierarchical provisional ownership. A class only sees unresolved samples.
    for road_class in classes:
        for part_index, (_, samples) in enumerate(samples_by_part):
            proposals = [None] * len(samples)
            previous = None
            for sample_index in range(len(samples)):
                if owners[part_index][sample_index] is not None:
                    previous = None
                    continue
                choices = candidates(part_index, sample_index, road_class)
                if choices:
                    adjusted = [(cost - (min(float(settings["edgeSwitchCost"]), 2.0) if edge == previous else 0), edge)
                                for _, cost, edge in choices]
                    _, edge = min(adjusted)
                    proposals[sample_index] = previous = edge
                else:
                    previous = None
            for run in _ownership_runs(proposals):
                if run["end"] - run["start"] >= minimum_run:
                    owners[part_index][run["start"]:run["end"]] = proposals[run["start"]:run["end"]]

    # Complete source atoms validate ownership; they never create candidate ownership.
    for _ in range(int(settings["ownershipContinuityIterations"])):
        changed = False
        for part_index, part_owners in enumerate(owners):
            runs = _ownership_runs(part_owners)
            for run_index, run in enumerate(runs):
                previous, following = _neighbor_runs(runs, run_index, maximum_bridge)
                edge = run["edge"]
                edge_rank = rank.get(edge_classes[edge], len(rank))
                lower_than_neighbor = any(
                    edge_rank > rank.get(edge_classes[neighbor["edge"]], len(rank))
                    for neighbor in (previous, following) if neighbor)
                if not lower_than_neighbor:
                    continue
                upstream = previous is None or bool(junctions(previous["edge"], edge))
                downstream = following is None or bool(junctions(edge, following["edge"]))
                # Interior lower-class substitutions and bridges need both handoffs;
                # route-start/end continuations only have the available handoff.
                if upstream and downstream:
                    continue
                for sample_index in range(run["start"], run["end"]):
                    alternatives = candidates(part_index, sample_index, excluded={edge})
                    def handoff_penalty(choice):
                        candidate_edge = choice[2]
                        missing = 0
                        if previous and candidate_edge != previous["edge"] and not junctions(previous["edge"], candidate_edge):
                            missing += 1
                        if following and candidate_edge != following["edge"] and not junctions(candidate_edge, following["edge"]):
                            missing += 1
                        return missing, choice[0], choice[1], choice[2]
                    replacement = min(alternatives, key=handoff_penalty)[2] if alternatives else None
                    reassigned_from[part_index][sample_index] = int(source_feature_indices[edge])
                    part_owners[sample_index] = replacement
                changed = True
        if not changed:
            break

    # Reference parts are deliberately solved independently so that two real
    # carriageways can choose two distinct N13 atoms.  Reconcile only sustained
    # *cross-class* ownership on nearby parallel parts afterwards.  In
    # particular, do not deduplicate same-class winners: those are the normal
    # divided-road case.  Requiring a run also leaves the small geometric
    # overlap around a genuine longitudinal class handoff alone.
    parallel_distance = float(settings["crossClassParallelSearchMeters"])
    parallel_minimum = int(settings["crossClassParallelMinimumSamples"])
    reference_sample_records = [(part_index, sample_index, sample)
                                for part_index, (_, samples) in enumerate(samples_by_part)
                                for sample_index, sample in enumerate(samples)]
    reference_sample_index = gpd.GeoSeries(
        [sample for _, _, sample in reference_sample_records], crs=METRIC_CRS).sindex
    cross_class_parallel_sample_comparisons = 0
    cross_class_parallel_candidate_pairs = 0
    conflict_masks = [[False] * len(points) for _, points in samples_by_part]
    for part_index, (_, samples) in enumerate(samples_by_part):
        for sample_index, sample in enumerate(samples):
            edge = owners[part_index][sample_index]
            if edge is None:
                continue
            edge_rank = rank.get(edge_classes[edge], len(rank))
            query_bounds = box(sample.x - parallel_distance, sample.y - parallel_distance,
                               sample.x + parallel_distance, sample.y + parallel_distance)
            nearby_positions = map(int, reference_sample_index.query(query_bounds))
            for position in nearby_positions:
                other_part, other_index, other_sample = reference_sample_records[position]
                if other_part == part_index:
                    continue
                cross_class_parallel_sample_comparisons += 1
                if sample.distance(other_sample) > parallel_distance:
                    continue
                cross_class_parallel_candidate_pairs += 1
                other_edge = owners[other_part][other_index]
                if other_edge is None or edge_classes[other_edge] == edge_classes[edge]:
                    continue
                mismatch = _angle_difference(reference_vectors[part_index][sample_index],
                                             reference_vectors[other_part][other_index])
                if (mismatch <= maximum_angle
                        and edge_rank > rank.get(edge_classes[other_edge], len(rank))):
                    conflict_masks[part_index][sample_index] = True
                    break
    for part_index, mask in enumerate(conflict_masks):
        start = 0
        while start < len(mask):
            if not mask[start]:
                start += 1
                continue
            end = start + 1
            while end < len(mask) and mask[end]:
                end += 1
            if end - start >= parallel_minimum:
                for sample_index in range(start, end):
                    edge = owners[part_index][sample_index]
                    reassigned_from[part_index][sample_index] = int(source_feature_indices[edge])
                    owners[part_index][sample_index] = None
                    cross_class_parallel_rejections += 1
            start = end

    # Heal a tiny disturbance on one original atom before extracting substrings.
    for part_owners in owners:
        runs = _ownership_runs(part_owners)
        for left_index, left in enumerate(runs):
            for right in runs[left_index + 1:]:
                if right["edge"] == left["edge"]:
                    if right["start"] - left["end"] <= maximum_bridge:
                        part_owners[left["end"]:right["start"]] = [left["edge"]] * (right["start"] - left["end"])
                    break

    run_rows = []
    connected_transitions = disconnected_transitions = extensions = 0
    for part_index, (offsets, samples) in enumerate(samples_by_part):
        runs = _ownership_runs(owners[part_index])
        for run_index, run in enumerate(runs):
            edge = run["edge"]
            line = frame.at[edge, "geometry"]
            projected = [float(line.project(samples[i])) for i in range(run["start"], run["end"])]
            run["entryProject"] = projected[0]
            run["exitProject"] = projected[-1]
            run["sourceStart"] = max(0.0, min(projected) - interval / 2)
            run["sourceEnd"] = min(float(line.length), max(projected) + interval / 2)
            run["before"] = (run["sourceStart"], run["sourceEnd"])
            run["upstream"] = run_index == 0
            run["downstream"] = run_index == len(runs) - 1
        for run_index in range(len(runs) - 1):
            first, second = runs[run_index], runs[run_index + 1]
            if second["start"] - first["end"] > maximum_bridge:
                disconnected_transitions += 1
                continue
            if first["edge"] == second["edge"]:
                transition_junctions = [(first["sourceEnd"], second["sourceStart"])]
            else:
                transition_junctions = junctions(first["edge"], second["edge"])
            if not transition_junctions:
                disconnected_transitions += 1
                continue
            junction = min(transition_junctions, key=lambda value: abs(value[0] - first["exitProject"])
                           + abs(value[1] - second["entryProject"]))
            first_extension = abs(junction[0] - first["exitProject"])
            second_extension = abs(junction[1] - second["entryProject"])
            if max(first_extension, second_extension) > float(settings["maximumJunctionExtensionMeters"]):
                disconnected_transitions += 1
                continue
            first["sourceStart"] = min(first["sourceStart"], junction[0])
            first["sourceEnd"] = max(first["sourceEnd"], junction[0])
            second["sourceStart"] = min(second["sourceStart"], junction[1])
            second["sourceEnd"] = max(second["sourceEnd"], junction[1])
            first["downstream"] = second["upstream"] = True
            connected_transitions += 1
            if first_extension > 1e-9 or second_extension > 1e-9:
                extensions += 1
        for run_index, run in enumerate(runs):
            edge = run["edge"]
            before = run["before"]
            geometry = substring(frame.at[edge, "geometry"], run["sourceStart"], run["sourceEnd"])
            if geometry.geom_type != "LineString" or geometry.length <= 0:
                continue
            row = frame.loc[edge].copy()
            row["geometry"] = geometry
            row["referencePart"] = part_index
            row["firstOwnedReferenceSample"] = run["start"]
            row["lastOwnedReferenceSample"] = run["end"] - 1
            row["ownedReferenceSampleCount"] = run["end"] - run["start"]
            row["ownedReferenceStartMeters"] = float(offsets[run["start"]])
            row["ownedReferenceEndMeters"] = float(offsets[run["end"] - 1])
            row["sourceStartDistanceMeters"] = run["sourceStart"]
            row["sourceEndDistanceMeters"] = run["sourceEnd"]
            row["runPosition"] = ("start continuation" if run["start"] <= maximum_bridge else
                                  "end continuation" if len(owners[part_index]) - run["end"] <= maximum_bridge
                                  else "interior")
            row["upstreamSourceConnected"] = bool(run["upstream"])
            row["downstreamSourceConnected"] = bool(run["downstream"])
            row["continuityValid"] = bool(run["upstream"] and run["downstream"])
            row["sourceRangeBeforeExtension"] = json.dumps([round(value, 3) for value in before])
            row["sourceRangeAfterExtension"] = json.dumps(
                [round(run["sourceStart"], 3), round(run["sourceEnd"], 3)])
            row["junctionExtensionMeters"] = round(
                abs(run["sourceStart"] - before[0]) + abs(run["sourceEnd"] - before[1]), 3)
            sources = {reassigned_from[part_index][i] for i in range(run["start"], run["end"])
                       if reassigned_from[part_index][i] is not None}
            row["reassignedFromSourceFeatureIndex"] = ",".join(map(str, sorted(sources))) if sources else None
            row["selectionStatus"] = row["selectionReason"] = "accepted-owned-samples"
            run_rows.append(row)

    accepted = gpd.GeoDataFrame(run_rows, crs=METRIC_CRS) if run_rows else frame.iloc[0:0].copy()
    owned_edges = {run["edge"] for part in owners for run in _ownership_runs(part)}
    frame["selectionStatus"] = ["accepted-owned-samples" if edge in owned_edges else "rejected-no-owned-run"
                                for edge in frame.index]
    frame["selectionReason"] = frame["selectionStatus"]
    frame["ownedReferenceSampleCount"] = [sum(owner == edge for part in owners for owner in part) for edge in frame.index]
    ownership_features = []
    for part_index, (offsets, samples) in enumerate(samples_by_part):
        for sample_index, (offset, sample) in enumerate(zip(offsets, samples)):
            edge = owners[part_index][sample_index]
            road_class = edge_classes[edge] if edge is not None else None
            ownership_features.append({"type": "Feature", "properties": {
                "referencePart": part_index, "referenceSample": sample_index,
                "referenceDistanceMeters": round(float(offset), 3), "ownershipClass": road_class,
                "ownershipStatus": f"class-{road_class}" if road_class else "unmatched",
                "sourceFeatureIndex": int(source_feature_indices[edge]) if edge is not None else None,
                "reassignedFromSourceFeatureIndex": reassigned_from[part_index][sample_index],
            }, "geometry": mapping(sample)})
    counts = Counter(frame.selectionReason)
    reference_sample_count = sum(len(samples) for _, samples in samples_by_part)
    report = {"stage1CandidateCount": len(frame), "ownershipRunCount": len(accepted),
              "referenceSampleCount": reference_sample_count, "candidateEdgeCount": len(frame),
              "candidateComparisonsPerformed": candidate_comparisons,
              "meanCandidatesPerSample": round(candidate_comparisons / reference_sample_count, 3)
              if reference_sample_count else 0,
              "maxCandidatesPerSample": max(candidates_per_sample.values(), default=0),
              "ownershipSeconds": round(time.perf_counter() - started, 4),
              "sourceConnectedRunTransitions": connected_transitions,
              "sourceDisconnectedRunTransitions": disconnected_transitions,
              "junctionExtensionsApplied": extensions, "backboneSelectedCount": len(accepted),
              "crossClassParallelRejectedSampleCount": cross_class_parallel_rejections,
              "crossClassParallelSampleComparisons": cross_class_parallel_sample_comparisons,
              "crossClassParallelCandidatePairs": cross_class_parallel_candidate_pairs,
              "parallelSelectedCount": int(sum(accepted.referencePart > 0)) if not accepted.empty else 0,
              "rejectedCount": int(frame.selectionStatus.str.startswith("rejected-").sum()),
              "rejectionReasonCounts": {key: value for key, value in counts.items() if key.startswith("rejected-")},
              "stage1LengthMeters": round(float(frame.geometry.length.sum()), 3),
              "selectedLengthMeters": round(float(accepted.geometry.length.sum()), 3),
              "referencePartInference": [{"referencePart": index, "sampleCount": len(owners[index]),
                  "matchedSampleCount": sum(owner is not None for owner in owners[index])}
                  for index in range(len(parts))], "repairedGaps": [], "parameters": settings}
    frame.attrs["ownershipSamples"] = gpd.GeoDataFrame.from_features(ownership_features, crs=METRIC_CRS)
    return accepted, frame, report


def connect_adjacent_selected_runs(selected: gpd.GeoDataFrame, stage1_candidates: gpd.GeoDataFrame,
                                   osm_reference, config: dict | None = None):
    """Recover unambiguous source-native pieces between consecutive owned runs."""
    settings = {**DEFAULT_NETWORK_SELECTION, **(config or {})}
    if selected.empty:
        return selected.copy(), {"continuityConnectorCount": 0,
                                 "continuityConnectorLengthMeters": 0.0,
                                 "continuityUnresolvedGapCount": 0, "continuityConnectors": []}
    tolerance = float(settings["endpointSnapMeters"])
    corridor = float(settings["maximumSampleDistanceMeters"])
    maximum_length = float(settings["maximumGapConnectorMeters"])
    maximum_detour = float(settings["maximumGapDetourRatio"])
    maximum_edges = int(settings.get("continuityMaximumIntermediateFeatures", 2))
    window_buffer = float(settings.get("continuityReferenceWindowBufferMeters",
                                       settings["progressSampleMeters"] * 2))
    parts = _ordered_reference_parts(osm_reference)
    source = stage1_candidates.copy()
    source["_connectorSourceFeatureIndex"] = (source["sourceFeatureIndex"]
                                               if "sourceFeatureIndex" in source else source.index)
    exploded = source.explode(index_parts=True)
    atom_indices = (exploded.index.get_level_values(-1).to_numpy()
                    if isinstance(exploded.index, pd.MultiIndex) else np.zeros(len(exploded), dtype=int))
    source = exploded.reset_index(drop=True)
    source["sourceFeatureIndex"] = source.pop("_connectorSourceFeatureIndex")
    if "sourceAtomIndex" not in source:
        source["sourceAtomIndex"] = atom_indices
    source_classes = source.N13_003.astype(str).tolist()
    source_geometries = list(source.geometry)
    source_index = source.geometry.sindex
    result = selected.copy().reset_index(drop=True)
    decisions = []
    connector_rows = []
    unresolved = 0

    def atom(row):
        matches = source[(source.sourceFeatureIndex == row.sourceFeatureIndex)
                         & (source.sourceAtomIndex == row.sourceAtomIndex)]
        return int(matches.index[0]) if not matches.empty else None

    def extend(row_index, position):
        parent = source_geometries[atom(result.loc[row_index])]
        start = min(float(result.at[row_index, "sourceStartDistanceMeters"]), position)
        end = max(float(result.at[row_index, "sourceEndDistanceMeters"]), position)
        result.at[row_index, "sourceStartDistanceMeters"] = start
        result.at[row_index, "sourceEndDistanceMeters"] = end
        result.at[row_index, "geometry"] = substring(parent, start, end)

    for part_index, reference_part in enumerate(parts):
        ordered = list(result[result.referencePart == part_index].sort_values(
            ["ownedReferenceStartMeters", "ownedReferenceEndMeters"]).index)
        for upstream_index, downstream_index in zip(ordered, ordered[1:]):
            if upstream_index not in result.index or downstream_index not in result.index:
                continue
            upstream = result.loc[upstream_index]
            downstream = result.loc[downstream_index]
            gap_start = float(upstream.ownedReferenceEndMeters)
            gap_end = float(downstream.ownedReferenceStartMeters)
            gap = max(0.0, gap_end - gap_start)
            if gap <= 1e-9:
                continue
            base = {"upstreamSourceFeatureIndex": int(upstream.sourceFeatureIndex),
                    "downstreamSourceFeatureIndex": int(downstream.sourceFeatureIndex),
                    "referencePart": part_index, "referenceGapStartMeters": round(gap_start, 3),
                    "referenceGapEndMeters": round(gap_end, 3), "referenceGapMeters": round(gap, 3)}
            if gap > maximum_length:
                unresolved += 1
                decisions.append({**base, "connectorSourceFeatureIndices": [], "connectorClasses": [],
                                  "connectorLengthMeters": 0.0, "connectorDetourRatio": None,
                                  "decision": "unresolved-gap-too-long"})
                continue
            upstream_atom, downstream_atom = atom(upstream), atom(downstream)
            if upstream_atom is None or downstream_atom is None:
                unresolved += 1
                decisions.append({**base, "connectorSourceFeatureIndices": [], "connectorClasses": [],
                                  "connectorLengthMeters": 0.0, "connectorDetourRatio": None,
                                  "decision": "unresolved-missing-parent"})
                continue
            if upstream_atom == downstream_atom:
                source_gap = max(0.0, float(downstream.sourceStartDistanceMeters)
                                 - float(upstream.sourceEndDistanceMeters))
                if source_gap <= maximum_length and source_gap / max(gap, 1.0) <= maximum_detour:
                    extend(upstream_index, float(downstream.sourceStartDistanceMeters))
                    extend(upstream_index, float(downstream.sourceEndDistanceMeters))
                    result = result.drop(index=downstream_index)
                    decisions.append({**base, "connectorSourceFeatureIndices": [],
                                      "connectorClasses": [str(upstream.N13_003)],
                                      "connectorLengthMeters": round(source_gap, 3),
                                      "connectorDetourRatio": round(source_gap / max(gap, 1.0), 3),
                                      "decision": "accepted-same-source-range"})
                    continue
            direct = _source_junctions(source_geometries[upstream_atom],
                                       source_geometries[downstream_atom], tolerance)
            if direct:
                first, second = min(direct, key=lambda pair:
                    abs(pair[0] - float(upstream.sourceEndDistanceMeters))
                    + abs(pair[1] - float(downstream.sourceStartDistanceMeters)))
                extend(upstream_index, first)
                extend(downstream_index, second)
                decisions.append({**base, "connectorSourceFeatureIndices": [],
                                  "connectorClasses": sorted({str(upstream.N13_003), str(downstream.N13_003)}),
                                  "connectorLengthMeters": 0.0, "connectorDetourRatio": 0.0,
                                  "decision": "accepted-direct-source-junction"})
                continue

            gap_line = substring(reference_part, max(0.0, gap_start - window_buffer),
                                 min(reference_part.length, gap_end + window_buffer))
            nearby = list(map(int, source_index.query(gap_line.buffer(corridor))))
            allowed_classes = {str(upstream.N13_003), str(downstream.N13_003)}
            selected_atoms = {atom(row) for _, row in result.iterrows()}
            pool = []
            for edge in nearby:
                geometry = source_geometries[edge]
                projections = [float(reference_part.project(Point(coordinate))) for coordinate in geometry.coords]
                if (edge not in selected_atoms and source_classes[edge] in allowed_classes
                        and geometry.distance(gap_line) <= corridor
                        and min(projections) >= gap_start - window_buffer
                        and max(projections) <= gap_end + window_buffer):
                    pool.append(edge)

            paths = []
            def search(current, path):
                if len(path) > maximum_edges:
                    return
                if _source_junctions(source_geometries[current], source_geometries[downstream_atom], tolerance):
                    paths.append(path.copy())
                if len(path) == maximum_edges:
                    return
                for following in pool:
                    if following not in path and _source_junctions(
                            source_geometries[current], source_geometries[following], tolerance):
                        search(following, [*path, following])
            for edge in pool:
                if _source_junctions(source_geometries[upstream_atom], source_geometries[edge], tolerance):
                    search(edge, [edge])
            plausible = []
            for path in paths:
                length = sum(source_geometries[edge].length for edge in path)
                ratio = length / max(gap, 1.0)
                if length <= maximum_length and ratio <= maximum_detour:
                    plausible.append((path, length, ratio))
            if len(plausible) != 1:
                unresolved += 1
                decisions.append({**base, "connectorSourceFeatureIndices": [], "connectorClasses": [],
                                  "connectorLengthMeters": 0.0, "connectorDetourRatio": None,
                                  "decision": "unresolved-ambiguous" if plausible else "unresolved-no-path"})
                continue
            path, length, ratio = plausible[0]
            first_junction = _source_junctions(source_geometries[upstream_atom], source_geometries[path[0]], tolerance)[0]
            last_junction = _source_junctions(source_geometries[path[-1]], source_geometries[downstream_atom], tolerance)[0]
            extend(upstream_index, first_junction[0])
            extend(downstream_index, last_junction[1])
            for edge in path:
                row = source.loc[edge].copy()
                row["selectionStatus"] = row["selectionReason"] = "accepted-continuity-connector"
                row["referencePart"] = part_index
                row["ownedReferenceStartMeters"] = gap_start
                row["ownedReferenceEndMeters"] = gap_end
                connector_rows.append(row)
            decisions.append({**base,
                              "connectorSourceFeatureIndices": [int(source.at[edge, "sourceFeatureIndex"]) for edge in path],
                              "connectorClasses": sorted({source_classes[edge] for edge in path}),
                              "connectorLengthMeters": round(length, 3),
                              "connectorDetourRatio": round(ratio, 3), "decision": "accepted-connector"})
    if connector_rows:
        result = gpd.GeoDataFrame(pd.concat(
            [result, gpd.GeoDataFrame(connector_rows, crs=selected.crs)], ignore_index=True), crs=selected.crs)
    connector_length = sum(item["connectorLengthMeters"] for item in decisions
                           if item["decision"] in {"accepted-connector", "accepted-same-source-range"})
    connector_count = sum(item["decision"] in {"accepted-connector", "accepted-same-source-range"}
                          for item in decisions)
    return result, {"continuityConnectorCount": connector_count,
                    "continuityConnectorLengthMeters": round(connector_length, 3),
                    "continuityUnresolvedGapCount": unresolved, "continuityConnectors": decisions}


def write_selection_diagnostics(frame: gpd.GeoDataFrame, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_crs("EPSG:4326").to_file(output, driver="GeoJSON")


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
        "type": "road", "entityType": road.get("entityType", "statutory-road"), "sources": {
            "n13": f"data/roads/{road['id']}-n13.geojson",
            "osm": f"data/roads/{road['id']}-osm.geojson",
        },
    } for road in roads if all((PUBLIC_ROADS / f"{road['id']}-{source}.geojson").exists()
                               for source in ("n13", "osm"))]
    SEARCH_INDEX.parent.mkdir(parents=True, exist_ok=True)
    SEARCH_INDEX.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("road_id")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--sources", type=Path, default=SOURCE_CONFIG)
    parser.add_argument("--n13", type=Path, help="override the N13 cache path from source configuration")
    parser.add_argument("--refresh-osm", action="store_true")
    parser.add_argument("--overpass-url")
    parser.add_argument("--diagnostics", type=Path,
                        help="Stage-1 selection GeoJSON (default: data/diagnostics/<road-id>-selection.geojson)")
    args = parser.parse_args()
    road = load_road(args.registry, args.road_id)
    source_config = load_source_config(args.sources)
    n13_source = args.n13 or Path(source_config["n13"]["cache"])
    _, n13_manifest = load_n13_manifest(n13_source)
    coverage_bounds = n13_manifest["boundsWgs84"]
    osm, osm_provenance = build_osm_reference(
        road, source_config, coverage_bounds, args.refresh_osm, args.overpass_url)
    reference, reference_diagnostics = build_reference(road, osm)
    candidates = load_n13_candidates(road, n13_source, reference)
    class_diagnostics = candidates.attrs.get("classDiagnostics", {})
    match = road["matching"]
    stage1, candidates = match_n13(candidates, reference, road)
    if stage1.empty:
        raise RuntimeError(f"No plausible N13 features selected for {road['id']}")
    network_config = {**road.get("networkSelection", {}), "classPriority": road["n13"]["classifications"],
                      "endpointSnapMeters": road.get("display", {}).get("endpointSnapMeters", DEFAULT_ENDPOINT_SNAP_METERS)}
    selected, selection_diagnostics, network_report = select_reference_network(stage1, reference, network_config)
    if selected.empty:
        raise RuntimeError(f"Network selection found no canonical N13 backbone for {road['id']}")
    selected, connector_report = connect_adjacent_selected_runs(selected, stage1, reference, network_config)
    network_report.update(connector_report)
    connector_ids = set(selected.loc[selected.selectionStatus == "accepted-continuity-connector",
                                     "sourceFeatureIndex"])
    if connector_ids:
        connector_mask = selection_diagnostics.sourceFeatureIndex.isin(connector_ids)
        selection_diagnostics.loc[connector_mask, ["selectionStatus", "selectionReason"]] = \
            "accepted-continuity-connector"
    diagnostic_output = args.diagnostics or Path("data/diagnostics") / f"{road['id']}-selection.geojson"
    write_selection_diagnostics(selection_diagnostics, diagnostic_output)
    for road_class, values in class_diagnostics.items():
        values["selectedFeatureCount"] = int((selected["N13_003"].astype(str) == road_class).sum())
    coverage, unresolved = reference_coverage(
        reference, selected.geometry.union_all(), match["sampleIntervalMeters"], match["coverageToleranceMeters"]
    )
    display_config = road.get("display", {"endpointSnapMeters": DEFAULT_ENDPOINT_SNAP_METERS})
    display_geometry, stitching = build_display_chains(selected, reference, display_config)
    display_wgs84 = gpd.GeoSeries([display_geometry], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]
    common_properties = {
        "id": road["id"], "name": road["displayName"], "aliases": road["aliases"], "type": "road",
        "entityType": road["entityType"], "jurisdiction": road["jurisdiction"],
    }
    for optional in ("roadClass", "routeNumber"):
        if optional in road:
            common_properties[optional] = road[optional]
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
            "provenance": osm_provenance,
        }, "geometry": mapping(gpd.GeoSeries([reference], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]),
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
        "networkSelection": network_report,
        "osmReference": {**osm_provenance, **reference_diagnostics},
        "selectedN13Classifications": dict(Counter(selected["N13_003"].astype(str))),
        "statutoryComposition": {
            "routeRefs": dict(Counter(osm.get("ref", pd.Series(dtype=str)).dropna().astype(str))),
            "n13Classifications": dict(Counter(selected["N13_003"].astype(str))),
        },
        "n13Source": str(n13_source), "n13Coverage": n13_manifest,
        "n13ClassDiagnostics": class_diagnostics,
        "geometryProcessing": {**stitching, "endpointSnapMeters": float(display_config["endpointSnapMeters"])},
        "outputBytes": {"n13BeforeStitching": unstitched_bytes, "n13AfterStitching": n13_output.stat().st_size,
                        "n13": n13_output.stat().st_size, "osm": osm_output.stat().st_size},
        "outputs": {"n13": str(n13_output), "osm": str(osm_output), "selectionDiagnostics": str(diagnostic_output)},
    }
    (PUBLIC_ROADS / f"{road['id']}.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
