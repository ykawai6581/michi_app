"""Build one canonical road's display geometry from the road registry and N13."""

from __future__ import annotations

import argparse
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


def _local_orientation(line: LineString, point: Point, interval: float) -> np.ndarray:
    position = line.project(point)
    epsilon = min(max(interval / 2, .5), max(line.length / 2, .5))
    before = line.interpolate(max(0, position - epsilon))
    after = line.interpolate(min(line.length, position + epsilon))
    return np.asarray(after.coords[0]) - np.asarray(before.coords[0])


def _sample_reference(part: LineString, interval: float) -> tuple[np.ndarray, list[Point]]:
    offsets = np.unique(np.append(np.arange(0, part.length, interval), part.length))
    return offsets, [part.interpolate(float(offset)) for offset in offsets]


def select_reference_network(stage1: gpd.GeoDataFrame, reference, config: dict | None = None):
    """Reconstruct N13 substrings solely from ownership of OSM samples.

    Classes run in priority order.  A lower class never gets a candidate state
    for a confidently resolved sample; consequently connectivity cannot pull a
    stem or connector into the result.  Short ownership islands are discarded
    before their samples are resolved, allowing a lower class to explain them.
    """
    settings = {**DEFAULT_NETWORK_SELECTION, **(config or {})}
    if stage1.empty:
        return stage1.copy(), stage1.copy(), {}
    frame = stage1.explode(index_parts=True).reset_index().rename(
        columns={"level_0": "sourceFeatureIndex", "level_1": "sourceAtomIndex", "index": "sourceFeatureIndex"})
    if "sourceAtomIndex" not in frame:
        frame["sourceAtomIndex"] = 0
    parts = _ordered_reference_parts(reference)
    interval = float(settings["progressSampleMeters"])
    maximum_distance = float(settings["maximumSampleDistanceMeters"])
    maximum_angle = float(settings["maximumOrientationMismatchDegrees"])
    minimum_run = int(settings["minimumOwnedReferenceSamples"])
    configured = settings.get("classPriority")
    classes = [str(value) for value in configured] if configured else list(dict.fromkeys(frame.N13_003.astype(str)))
    samples_by_part = [_sample_reference(part, interval) for part in parts]
    owners = [[None] * len(points) for _, points in samples_by_part]
    owner_costs = [[None] * len(points) for _, points in samples_by_part]

    # Each pass proposes ownership only in unresolved domains. Staying on the
    # same source atom is a small prior, never a way to make a distant atom fit.
    for road_class in classes:
        class_edges = list(frame.index[frame.N13_003.astype(str) == road_class])
        for part_index, (offsets, samples) in enumerate(samples_by_part):
            proposals = [None] * len(samples)
            costs = [None] * len(samples)
            previous = None
            for sample_index, sample in enumerate(samples):
                if owners[part_index][sample_index] is not None:
                    previous = None
                    continue
                reference_vector = _local_orientation(parts[part_index], sample, interval)
                choices = []
                for edge in class_edges:
                    line = frame.at[edge, "geometry"]
                    distance = float(line.distance(sample))
                    if distance > maximum_distance:
                        continue
                    mismatch = _angle_difference(_local_orientation(line, sample, interval), reference_vector)
                    if mismatch > maximum_angle:
                        continue
                    cost = distance + mismatch * float(settings["orientationCostWeight"])
                    if edge == previous:
                        cost -= min(float(settings["edgeSwitchCost"]), 2.0)
                    elif previous is not None and line.distance(frame.at[previous, "geometry"]) > float(
                            settings["endpointSnapMeters"]):
                        # Connectivity only breaks ties between already valid
                        # owners; it can never admit geometry outside the
                        # distance/orientation gates above.
                        cost += float(settings["edgeSwitchCost"])
                    choices.append((cost, edge))
                if choices:
                    cost, edge = min(choices)
                    proposals[sample_index], costs[sample_index], previous = edge, cost, edge
                else:
                    previous = None
            index = 0
            while index < len(proposals):
                edge = proposals[index]
                if edge is None:
                    index += 1
                    continue
                end = index + 1
                while end < len(proposals) and proposals[end] == edge:
                    end += 1
                if end - index >= minimum_run:
                    owners[part_index][index:end] = proposals[index:end]
                    owner_costs[part_index][index:end] = costs[index:end]
                index = end

    runs = []
    ownership_features = []
    for part_index, (offsets, samples) in enumerate(samples_by_part):
        for sample_index, (offset, sample) in enumerate(zip(offsets, samples)):
            edge = owners[part_index][sample_index]
            road_class = str(frame.at[edge, "N13_003"]) if edge is not None else None
            ownership_features.append({"type": "Feature", "properties": {
                "referencePart": part_index, "referenceSample": sample_index,
                "referenceDistanceMeters": round(float(offset), 3),
                "ownershipClass": road_class, "ownershipStatus": f"class-{road_class}" if road_class else "unmatched",
                "sourceFeatureIndex": int(frame.at[edge, "sourceFeatureIndex"]) if edge is not None else None,
            }, "geometry": mapping(sample)})
        index = 0
        while index < len(owners[part_index]):
            edge = owners[part_index][index]
            if edge is None:
                index += 1
                continue
            end = index + 1
            while end < len(owners[part_index]) and owners[part_index][end] == edge:
                end += 1
            line = frame.at[edge, "geometry"]
            projected = [float(line.project(samples[i])) for i in range(index, end)]
            source_start = max(0.0, min(projected) - interval / 2)
            source_end = min(float(line.length), max(projected) + interval / 2)
            geometry = substring(line, source_start, source_end)
            if geometry.geom_type == "LineString" and geometry.length > 0:
                row = frame.loc[edge].copy()
                row["geometry"] = geometry
                row["referencePart"] = part_index
                row["firstOwnedReferenceSample"] = index
                row["lastOwnedReferenceSample"] = end - 1
                row["ownedReferenceSampleCount"] = end - index
                row["ownedReferenceStartMeters"] = float(offsets[index])
                row["ownedReferenceEndMeters"] = float(offsets[end - 1])
                row["sourceStartDistanceMeters"] = source_start
                row["sourceEndDistanceMeters"] = source_end
                row["selectionStatus"] = "accepted-owned-samples"
                row["selectionReason"] = "accepted-owned-samples"
                runs.append(row)
            index = end
    accepted = gpd.GeoDataFrame(runs, crs=METRIC_CRS) if runs else frame.iloc[0:0].copy()
    owned_edges = set(accepted.index) if not accepted.empty else set()
    frame["selectionStatus"] = ["accepted-owned-samples" if edge in owned_edges else "rejected-no-owned-run" for edge in frame.index]
    frame["selectionReason"] = frame["selectionStatus"]
    frame["ownedReferenceSampleCount"] = [sum(owner == edge for part in owners for owner in part) for edge in frame.index]
    counts = Counter(frame.selectionReason)
    report = {
        "stage1CandidateCount": len(frame),
        "ownershipRunCount": len(accepted),
        "backboneSelectedCount": len(accepted),
        "parallelSelectedCount": int(sum(accepted.referencePart > 0)) if not accepted.empty else 0,
        "rejectedCount": int(frame.selectionStatus.str.startswith("rejected-").sum()),
        "rejectionReasonCounts": {key: value for key, value in counts.items() if key.startswith("rejected-")},
        "stage1LengthMeters": round(float(frame.geometry.length.sum()), 3),
        "selectedLengthMeters": round(float(accepted.geometry.length.sum()), 3),
        "referencePartInference": [{"referencePart": index, "sampleCount": len(owners[index]),
            "matchedSampleCount": sum(owner is not None for owner in owners[index])}
            for index in range(len(parts))],
        "repairedGaps": [],
        "parameters": settings,
    }
    frame.attrs["ownershipSamples"] = gpd.GeoDataFrame.from_features(ownership_features, crs=METRIC_CRS)
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
    network_config = {**road.get("networkSelection", {}), "classPriority": road["n13"]["classifications"],
                      "endpointSnapMeters": road.get("display", {}).get("endpointSnapMeters", DEFAULT_ENDPOINT_SNAP_METERS)}
    selected, selection_diagnostics, network_report = select_reference_network(stage1, reference, network_config)
    if selected.empty:
        raise RuntimeError(f"Network selection found no canonical N13 backbone for {road['id']}")
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
