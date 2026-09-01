"""Build one canonical road's display geometry from the road registry and N13."""

from __future__ import annotations

import argparse
import heapq
import json
import math
import warnings
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString, MultiLineString, Point, box, mapping
from shapely.ops import linemerge, unary_union

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
}
DEFAULT_BRANCH_PRUNING = {
    "enabled": True,
    "minimumProgressRatio": 0.6,
    "minimumMonotonicity": 0.8,
    "maximumDetourRatio": 1.5,
    "maximumResidualMeters": 35.0,
    "maximumOrientationMismatchDegrees": 55.0,
    "sampleIntervalMeters": 5.0,
    "endpointSnapMeters": DEFAULT_ENDPOINT_SNAP_METERS,
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
        corridor_meters = float(road.get("matching", {}).get("spatialShortlistMeters", 50))
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


def _progression_metrics(line: LineString, reference_parts: list[LineString], interval: float) -> dict:
    """Project ordered N13 samples to the closest OSM part and measure route progress."""
    offsets = np.unique(np.append(np.arange(0, line.length, interval), line.length))
    samples = [line.interpolate(float(offset)) for offset in offsets]
    nearest = [min(range(len(reference_parts)), key=lambda index: reference_parts[index].distance(point))
               for point in samples]
    part_counts = Counter(nearest)
    part_index = part_counts.most_common(1)[0][0]
    part = reference_parts[part_index]
    chainages = np.asarray([part.project(point) for point in samples])
    residuals = np.asarray([part.distance(point) for point in samples])
    deltas = np.diff(chainages)
    positive = float(deltas[deltas > 0].sum()); negative = float(-deltas[deltas < 0].sum())
    travelled = positive + negative
    monotonicity = max(positive, negative) / travelled if travelled > 1e-9 else 0.0
    progress = abs(float(chainages[-1] - chainages[0]))
    span = float(chainages.max() - chainages.min())
    orientation = []
    for index in range(len(samples) - 1):
        vector = np.asarray(samples[index + 1].coords[0]) - np.asarray(samples[index].coords[0])
        chainage = (chainages[index] + chainages[index + 1]) / 2
        epsilon = min(max(interval / 2, .5), max(part.length / 2, .5))
        before = part.interpolate(max(0, chainage - epsilon)); after = part.interpolate(min(part.length, chainage + epsilon))
        orientation.append(_angle_difference(vector, np.asarray(after.coords[0]) - np.asarray(before.coords[0])))
    return {
        "referencePart": part_index,
        "referenceStartMeters": float(chainages[0]), "referenceEndMeters": float(chainages[-1]),
        "referenceSpanMeters": span, "referenceProgressMeters": progress,
        "progressRatio": progress / line.length if line.length else 0.0,
        "chainageMonotonicity": monotonicity,
        "orientationMismatchDegrees": float(np.median(orientation)) if orientation else 90.0,
        "medianResidualMeters": float(np.median(residuals)),
        "p90ResidualMeters": float(np.percentile(residuals, 90)),
        "maxResidualMeters": float(residuals.max()),
        # Never aggressively compare scalar chainages across unrelated parts.
        "referencePartConsistent": len(part_counts) == 1,
    }


def _endpoint_graph(lines: list[LineString], tolerance: float):
    """Return endpoint-snapped reasoning nodes without altering source coordinates."""
    endpoints = [(edge, end, Point(line.coords[end])) for edge, line in enumerate(lines) for end in (0, -1)]
    clusters: list[list[tuple[int, int, Point]]] = []
    for endpoint in endpoints:
        cluster = next((items for items in clusters
                        if all(endpoint[2].distance(item[2]) <= tolerance for item in items)), None)
        if cluster is None:
            clusters.append([endpoint])
        else:
            cluster.append(endpoint)
    nodes = {}
    for node, cluster in enumerate(clusters):
        for edge, end, _ in cluster:
            nodes[(edge, end)] = node
    edge_nodes = {edge: (nodes[(edge, 0)], nodes[(edge, -1)]) for edge in range(len(lines))}
    incident = {node: set() for node in range(len(clusters))}
    for edge, (start, end) in edge_nodes.items():
        incident[start].add(edge); incident[end].add(edge)
    return edge_nodes, incident


def _maximal_graph_paths(active: set[int], edge_nodes, incident):
    """Yield terminal/junction-to-terminal/junction paths in an edge graph."""
    degree = {node: len(edges & active) for node, edges in incident.items()}
    boundaries = {node for node, value in degree.items() if value != 2}
    paths, used = [], set()
    for anchor in boundaries:
        for first in incident[anchor] & active:
            if first in used:
                continue
            path, edge, node = [], first, anchor
            while edge not in used:
                used.add(edge); path.append(edge)
                start, end = edge_nodes[edge]
                node = end if node == start else start
                if node in boundaries:
                    break
                following = (incident[node] & active) - {edge}
                if not following:
                    break
                edge = next(iter(following))
            paths.append((anchor, node, path))
    # Closed components have no boundary. They are uncertain and intentionally
    # omitted rather than being aggressively removed.
    return paths


def _interval_unique_length(part: int, low: float, high: float, excluded: set[int], frame, active: set[int]) -> float:
    intervals = []
    for edge in active - excluded:
        row = frame.iloc[edge]
        if int(row.referencePart) != part or not bool(row.referencePartConsistent):
            continue
        start = max(low, min(float(row.referenceStartMeters), float(row.referenceEndMeters)))
        end = min(high, max(float(row.referenceStartMeters), float(row.referenceEndMeters)))
        if end > start:
            intervals.append((start, end))
    intervals.sort()
    covered = 0.0; cursor = low
    for start, end in ((min(a, b), max(a, b)) for a, b in intervals):
        if start > cursor:
            covered += start - cursor
        cursor = max(cursor, end)
    covered += max(0.0, high - cursor)
    return covered


def prune_selected_branches(selected_n13, osm_reference, config: dict | None = None):
    """Conservatively remove poor-progress source branches after network selection."""
    settings = {**DEFAULT_BRANCH_PRUNING, **(config or {})}
    frame = selected_n13.explode(index_parts=False).copy()
    # Network selection already supplies sourceFeatureIndex. Preserve it rather
    # than creating a duplicate-named column: duplicate columns make pandas
    # concat/reindex fail when branch rejections join the diagnostics layer.
    if "sourceFeatureIndex" not in frame.columns:
        frame["sourceFeatureIndex"] = frame.index
    frame = frame.reset_index(drop=True)
    empty_report = {"candidateBranches": 0, "rejectedBranches": 0, "retainedAlternativePaths": 0,
                    "protectedUniqueCoverageBranches": 0, "iterations": 0, "branches": []}
    if frame.empty or not settings["enabled"]:
        return frame.copy(), frame.iloc[0:0].copy(), empty_report
    parts = _ordered_reference_parts(osm_reference)
    metrics = [_progression_metrics(line, parts, float(settings["sampleIntervalMeters"])) for line in frame.geometry]
    for key in metrics[0]:
        frame[key] = [metric[key] for metric in metrics]
    frame["branchLengthMeters"] = frame.geometry.length
    frame["chainageSpanMeters"] = frame.referenceSpanMeters
    frame["monotonicity"] = frame.chainageMonotonicity
    frame["detourRatio"] = frame.branchLengthMeters / frame.referenceProgressMeters.clip(lower=1e-9)
    edge_nodes, incident = _endpoint_graph(list(frame.geometry), float(settings["endpointSnapMeters"]))
    active, rejected, branch_reports = set(frame.index), {}, []
    protected_paths, retained_alternatives, iterations = set(), set(), 0
    while active:  # Each successful iteration removes at least one source edge.
        iterations += 1; removed = False
        paths = _maximal_graph_paths(active, edge_nodes, incident)
        for start, end, path in paths:
            dangling = start == end or len(incident[start] & active) == 1 or len(incident[end] & active) == 1
            reconnecting = not dangling and len(incident[start] & active) > 2 and len(incident[end] & active) > 2
            if not (dangling or reconnecting):
                continue
            subset = frame.iloc[path]
            length = float(subset.branchLengthMeters.sum())
            consistent = bool(subset.referencePartConsistent.all()) and subset.referencePart.nunique() == 1
            low = float(subset[["referenceStartMeters", "referenceEndMeters"]].min().min())
            high = float(subset[["referenceStartMeters", "referenceEndMeters"]].max().max())
            span = high - low
            progress_ratio = span / length if length else 0.0
            monotonicity = float(np.average(subset.chainageMonotonicity, weights=subset.branchLengthMeters))
            max_residual = float(subset.maxResidualMeters.max())
            orientation = float(np.average(subset.orientationMismatchDegrees, weights=subset.branchLengthMeters))
            detour = length / max(span, 1e-9)
            poor = []
            if progress_ratio < float(settings["minimumProgressRatio"]): poor.append("low-chainage-progress")
            if monotonicity < float(settings["minimumMonotonicity"]): poor.append("chainage-backtracking")
            if detour > float(settings["maximumDetourRatio"]): poor.append("excessive-detour")
            if max_residual > float(settings["maximumResidualMeters"]): poor.append("excessive-lateral-excursion")
            if orientation > float(settings["maximumOrientationMismatchDegrees"]): poor.append("poor-orientation")
            report = {"sourceEdges": path, "topology": "dangling" if dangling else "alternative",
                      "branchLengthMeters": round(length, 3), "chainageSpanMeters": round(span, 3),
                      "progressRatio": round(progress_ratio, 3), "monotonicity": round(monotonicity, 3),
                      "detourRatio": round(detour, 3), "maxResidualMeters": round(max_residual, 3)}
            if not consistent:
                report["decision"] = "retained-uncertain-reference-parts"; branch_reports.append(report); continue
            if not poor:
                if reconnecting: retained_alternatives.add(tuple(path))
                report["decision"] = "retained-plausible"; branch_reports.append(report); continue
            unique = _interval_unique_length(int(subset.referencePart.iloc[0]), low, high, set(path), frame, active)
            meaningful = min(span * .25, 20.0) if span else 0.0
            if unique >= max(float(settings["sampleIntervalMeters"]) * 2, meaningful):
                protected_paths.add(tuple(path)); report["decision"] = "protected-unique-coverage"
                report["uniqueCoverageMeters"] = round(unique, 3); branch_reports.append(report); continue
            reason = ("dangling-spur" if dangling else
                      "excessive-detour" if "excessive-detour" in poor else poor[0])
            report["decision"] = "rejected"; report["rejectionReason"] = reason; branch_reports.append(report)
            for edge in path:
                rejected[edge] = (reason, report)
            active.difference_update(path); removed = True; break
        if not removed:
            break
    frame["rejectionReason"] = None
    for edge, (reason, report) in rejected.items():
        frame.loc[edge, "rejectionReason"] = reason
        for key in ("branchLengthMeters", "chainageSpanMeters", "progressRatio", "monotonicity",
                    "detourRatio", "maxResidualMeters"):
            frame.loc[edge, key] = report[key]
        frame.loc[edge, ["selectionStatus", "selectionReason"]] = [f"rejected-{reason}", reason]
    report = {"candidateBranches": len({tuple(item["sourceEdges"]) for item in branch_reports}),
              "rejectedBranches": len({tuple(item[1][1]["sourceEdges"]) for item in rejected.items()}),
              "retainedAlternativePaths": len(retained_alternatives),
              "protectedUniqueCoverageBranches": len(protected_paths), "iterations": iterations,
              "branches": branch_reports}
    return frame.loc[sorted(active)].copy(), frame.loc[sorted(rejected)].copy(), report


def _edge_adjacency(lines: list[LineString], tolerance: float) -> dict[int, set[int]]:
    """Build logical N13 topology, including endpoint-to-line-interior junctions.

    This graph is reasoning-only: detecting a junction never splits, moves, or
    otherwise changes the source geometry used for display.
    """
    adjacency = {edge: set() for edge in range(len(lines))}
    endpoints = [(edge, Point(coordinate)) for edge, line in enumerate(lines)
                 for coordinate in (line.coords[0], line.coords[-1])]
    for edge, endpoint in endpoints:
        for other, line in enumerate(lines):
            if edge != other and endpoint.distance(line) <= tolerance:
                adjacency[edge].add(other)
                adjacency[other].add(edge)
    return adjacency


def _edge_cost(row) -> float:
    """Cost physical distance, residual, turning mismatch, and unproductive travel."""
    ratio = max(float(row.progressRatio), .05)
    return float(row.geometry.length) * (1 + float(row.match_median_m) / 25
                                         + float(row.orientationMismatchDegrees) / 90
                                         + (1 / ratio - 1) * 1.5
                                         + (1 - float(row.chainageMonotonicity)) * 2)


def _local_orientation(line: LineString, point: Point, interval: float) -> np.ndarray:
    position = line.project(point)
    epsilon = min(max(interval / 2, .5), max(line.length / 2, .5))
    before = line.interpolate(max(0, position - epsilon))
    after = line.interpolate(min(line.length, position + epsilon))
    return np.asarray(after.coords[0]) - np.asarray(before.coords[0])


def _graph_path(start: int, goal: int, frame, adjacency, maximum_length: float,
                cache: dict[tuple[int, int, float], tuple[float, list[int]]]) -> tuple[float, list[int]]:
    """Return a bounded source-edge route; all progression penalties remain soft."""
    key = (start, goal, maximum_length)
    if key in cache:
        return cache[key]
    if start == goal:
        return 0.0, [start]
    queue = [(0.0, start, [start])]
    best = {start: 0.0}
    while queue:
        length, edge, path = heapq.heappop(queue)
        if edge == goal:
            cache[key] = (length, path)
            cache[(goal, start, maximum_length)] = (length, list(reversed(path)))
            return length, path
        if length > best.get(edge, float("inf")):
            continue
        for other in adjacency[edge]:
            # Reaching the goal's junction does not imply traversing its full
            # source geometry; only intermediate connector edges add length.
            candidate = length + (0.0 if other == goal else float(frame.iloc[other].geometry.length))
            if candidate <= maximum_length and candidate < best.get(other, float("inf")):
                best[other] = candidate
                heapq.heappush(queue, (candidate, other, path + [other]))
    cache[key] = (float("inf"), [])
    return cache[key]


def _sample_reference(part: LineString, interval: float) -> tuple[np.ndarray, list[Point]]:
    offsets = np.unique(np.append(np.arange(0, part.length, interval), part.length))
    return offsets, [part.interpolate(float(offset)) for offset in offsets]


def _infer_reference_sequence(part_index: int, part: LineString, frame, adjacency, settings,
                              path_cache) -> dict:
    """Viterbi inference over ordered OSM samples and nearby N13 source edges."""
    offsets, samples = _sample_reference(part, float(settings["progressSampleMeters"]))
    maximum_distance = float(settings["maximumSampleDistanceMeters"])
    states: list[list[int | None]] = []
    emissions: list[dict[int | None, float]] = []
    support: dict[int, list[float]] = {edge: [] for edge in frame.index}
    for offset, sample in zip(offsets, samples):
        osm_vector = _local_orientation(part, sample, float(settings["progressSampleMeters"]))
        nearby = []
        costs: dict[int | None, float] = {None: float(settings["unmatchedSampleCost"])}
        for edge, line in enumerate(frame.geometry):
            distance = float(line.distance(sample))
            if distance > maximum_distance:
                continue
            mismatch = _angle_difference(_local_orientation(line, sample, float(settings["progressSampleMeters"])),
                                         osm_vector)
            # Former hard eligibility metrics are deliberately soft. A poor
            # local edge can win when graph continuity and reference coverage
            # make it the necessary explanation for this sample.
            progress_penalty = max(0.0, float(settings["minimumProgressRatio"]) - float(frame.iloc[edge].progressRatio))
            monotonicity_penalty = max(0.0, float(settings["minimumChainageMonotonicity"])
                                       - float(frame.iloc[edge].chainageMonotonicity))
            orientation_excess = max(0.0, mismatch - float(settings["maximumOrientationMismatchDegrees"]))
            costs[edge] = (distance + mismatch * float(settings["orientationCostWeight"])
                           + progress_penalty * float(settings["progressCostWeight"])
                           + monotonicity_penalty * float(settings["monotonicityCostWeight"])
                           + orientation_excess * float(settings["orientationCostWeight"]))
            nearby.append(edge)
            support[edge].append(float(offset))
        states.append(nearby + [None])
        emissions.append(costs)

    supported_samples = [index for index, candidates in enumerate(states) if len(candidates) > 1]
    if not supported_samples:
        return {"part": part_index, "offsets": offsets, "states": [None] * len(samples),
                "paths": [], "support": support, "emissions": emissions, "cost": 0.0,
                "activeRange": None, "repairedGaps": []}
    first, last = min(supported_samples), max(supported_samples)
    costs = {state: emissions[first][state] for state in states[first]}
    histories = {state: [] for state in states[first]}
    connector_histories = {state: [] for state in states[first]}
    for sample_index in range(first + 1, last + 1):
        next_costs = {}
        next_histories = {}
        next_connectors = {}
        chainage_step = max(float(offsets[sample_index] - offsets[sample_index - 1]), 1.0)
        for current in states[sample_index]:
            best_choice = None
            for previous, previous_cost in costs.items():
                connector = []
                if current is None or previous is None:
                    transition = 0.0 if current == previous else float(settings["edgeSwitchCost"])
                elif current == previous:
                    transition = 0.0
                else:
                    length, connector = _graph_path(previous, current, frame, adjacency,
                                                    float(settings["maximumTransitionPathMeters"]), path_cache)
                    if not connector:
                        transition = float(settings["disconnectedTransitionCost"])
                    else:
                        # Switching and graph travel are penalized, but an awkward
                        # connector is never excluded by per-edge orientation/progress.
                        transition = float(settings["edgeSwitchCost"]) + max(0.0, length - chainage_step)
                    previous_chainage = float(frame.iloc[previous].referenceEndMeters)
                    current_chainage = float(frame.iloc[current].referenceEndMeters)
                    if current_chainage + chainage_step < previous_chainage:
                        transition += previous_chainage - current_chainage
                candidate = previous_cost + transition + emissions[sample_index][current]
                if best_choice is None or candidate < best_choice[0]:
                    best_choice = (candidate, previous, connector)
            next_costs[current] = best_choice[0]
            next_histories[current] = histories[best_choice[1]] + [best_choice[1]]
            next_connectors[current] = connector_histories[best_choice[1]] + [best_choice[2]]
        costs, histories, connector_histories = next_costs, next_histories, next_connectors
    final = min(costs, key=costs.get)
    sequence = histories[final] + [final]
    full_sequence = [None] * first + sequence + [None] * (len(samples) - last - 1)
    return {"part": part_index, "offsets": offsets, "states": full_sequence,
            "support": support, "emissions": emissions, "cost": float(costs[final]),
            "activeRange": (first, last), "transitionConnectors": connector_histories[final],
            "repairedGaps": []}


def _repair_internal_gaps(inference: dict, frame, adjacency, settings, path_cache) -> set[int]:
    """Connect selected states across internal unmatched sample runs when plausible."""
    repaired = set()
    states = inference["states"]
    index = 0
    while index < len(states):
        if states[index] is not None:
            index += 1
            continue
        start = index
        while index < len(states) and states[index] is None:
            index += 1
        if start == 0 or index == len(states):
            continue  # legitimate termination: never repair beyond supported coverage
        left, right = states[start - 1], states[index]
        gap_length = float(inference["offsets"][index] - inference["offsets"][start - 1])
        maximum = min(float(settings["maximumGapConnectorMeters"]),
                      gap_length * float(settings["maximumGapDetourRatio"]))
        connector_length, connector = _graph_path(left, right, frame, adjacency, maximum, path_cache)
        if connector and connector_length <= maximum:
            repaired.update(connector)
            inference["repairedGaps"].append({
                "referencePart": inference["part"],
                "startMeters": round(float(inference["offsets"][start]), 3),
                "endMeters": round(float(inference["offsets"][index - 1]), 3),
                "connectorLengthMeters": round(connector_length, 3),
                "sourceEdges": connector,
            })
    return repaired


def select_reference_network(stage1: gpd.GeoDataFrame, reference, config: dict | None = None):
    """Infer the source-edge sequence that best explains ordered OSM samples."""
    settings = {**DEFAULT_NETWORK_SELECTION, **(config or {})}
    if stage1.empty:
        return stage1.copy(), stage1.copy(), {}
    frame = stage1.explode(index_parts=False).reset_index().rename(columns={"index": "sourceFeatureIndex"})
    parts = _ordered_reference_parts(reference)
    metrics = [_progression_metrics(line, parts, float(settings["progressSampleMeters"])) for line in frame.geometry]
    for key in metrics[0]:
        frame[key] = [value[key] for value in metrics]
    frame["selectionStatus"] = "rejected-disconnected"; frame["selectionReason"] = "rejected-disconnected"
    frame["routeCost"] = [_edge_cost(row) for _, row in frame.iterrows()]
    adjacency = _edge_adjacency(list(frame.geometry), float(settings["endpointSnapMeters"]))
    path_cache = {}
    inferences = [_infer_reference_sequence(index, part, frame, adjacency, settings, path_cache)
                  for index, part in enumerate(parts)]
    membership: dict[int, set[int]] = {edge: set() for edge in frame.index}
    gap_repair: set[int] = set()
    sample_support = Counter()
    minimum_emission = {edge: float("inf") for edge in frame.index}
    for inference in inferences:
        for edge, offsets in inference["support"].items():
            sample_support[edge] += len(offsets)
        for sample_index, state in enumerate(inference["states"]):
            if state is not None:
                membership[state].add(inference["part"])
                minimum_emission[state] = min(minimum_emission[state], inference["emissions"][sample_index][state])
        for connector in inference.get("transitionConnectors", []):
            # Intermediate edges explain graph continuity rather than an
            # emission at one reference sample; expose them as gap repairs.
            gap_repair.update(connector[1:-1])
        gap_repair.update(_repair_internal_gaps(inference, frame, adjacency, settings, path_cache))
    selected = {edge for edge, support_parts in membership.items() if support_parts} | gap_repair
    frame["referenceSampleSupportCount"] = [sample_support[edge] for edge in frame.index]
    frame["emissionCost"] = [round(minimum_emission[edge], 3) if math.isfinite(minimum_emission[edge]) else None
                             for edge in frame.index]
    frame["backboneMembership"] = [edge in selected for edge in frame.index]
    frame["parallelOsmSupportPart"] = [",".join(map(str, sorted(membership[edge]))) if membership[edge] else None
                                       for edge in frame.index]
    frame["gapRepairMembership"] = [edge in gap_repair for edge in frame.index]
    for edge in selected:
        reason = "accepted-gap-repair" if edge in gap_repair and not membership[edge] else "accepted-backbone"
        if membership[edge] and min(membership[edge]) > 0:
            reason = "accepted-parallel-osm-supported"
        frame.loc[edge, ["selectionStatus", "selectionReason"]] = reason
    # Diagnose whole rejected chains, so a multi-edge route that leaves and
    # rejoins the backbone is a detour rather than two unrelated stems.
    rejected = set(frame.index) - selected
    while rejected:
        seed = rejected.pop()
        component = {seed}
        frontier = [seed]
        while frontier:
            for other in adjacency[frontier.pop()]:
                if other in rejected:
                    rejected.remove(other)
                    component.add(other)
                    frontier.append(other)
        attachments = set().union(*(adjacency[edge] & selected for edge in component))
        if len(attachments) >= 2:
            reason = "rejected-detour"
        elif len(attachments) == 1:
            reason = "rejected-spur"
        elif any(sample_support[edge] for edge in component):
            reason = "rejected-redundant-parallel"
        else:
            reason = "rejected-disconnected"
        frame.loc[list(component), ["selectionStatus", "selectionReason"]] = reason
    accepted = frame[frame.selectionStatus.str.startswith("accepted-")].copy()
    counts = Counter(frame.selectionReason)
    report = {
        "stage1CandidateCount": len(frame),
        "backboneSelectedCount": int((frame.selectionStatus == "accepted-backbone").sum()),
        "parallelSelectedCount": int((frame.selectionStatus == "accepted-parallel-osm-supported").sum()),
        "rejectedCount": int(frame.selectionStatus.str.startswith("rejected-").sum()),
        "rejectionReasonCounts": {key: value for key, value in counts.items() if key.startswith("rejected-")},
        "stage1LengthMeters": round(float(frame.geometry.length.sum()), 3),
        "selectedLengthMeters": round(float(accepted.geometry.length.sum()), 3),
        "referencePartInference": [{
            "referencePart": inference["part"],
            "sampleCount": len(inference["offsets"]),
            "matchedSampleCount": sum(state is not None for state in inference["states"]),
            "pathCost": round(inference["cost"], 3),
        } for inference in inferences],
        "repairedGaps": [gap for inference in inferences for gap in inference["repairedGaps"]],
        "parameters": settings,
    }
    return accepted, frame, report


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
    network_config = {**road.get("networkSelection", {}),
                      "endpointSnapMeters": road.get("display", {}).get("endpointSnapMeters", DEFAULT_ENDPOINT_SNAP_METERS)}
    selected, selection_diagnostics, network_report = select_reference_network(stage1, reference, network_config)
    if selected.empty:
        raise RuntimeError(f"Network selection found no canonical N13 backbone for {road['id']}")
    branch_config = {**road.get("matching", {}).get("branchPruning", {}),
                     "endpointSnapMeters": road.get("display", {}).get(
                         "endpointSnapMeters", DEFAULT_ENDPOINT_SNAP_METERS),
                     "maximumResidualMeters": road.get("matching", {}).get("branchPruning", {}).get(
                         "maximumResidualMeters", match["maximumP90ResidualMeters"])}
    selected, branch_rejected, branch_report = prune_selected_branches(selected, reference, branch_config)
    if selected.empty:
        raise RuntimeError(f"Branch pruning found no canonical N13 backbone for {road['id']}")
    if not branch_rejected.empty:
        # The diagnostics layer includes both sequence rejections and the new
        # source-edge pruning decisions used by Road Builder.
        selection_diagnostics = gpd.GeoDataFrame(
            pd.concat([selection_diagnostics, branch_rejected], ignore_index=True), crs=stage1.crs)
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
        "branchPruning": branch_report,
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
