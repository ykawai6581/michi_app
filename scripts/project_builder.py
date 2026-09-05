"""Materialize small, static browser bundles from reusable source caches."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import quote

SUPPORTED_LAYERS = {"modernRoads", "railways", "stations", "historicalRoads", "historicalPosts"}
OUTPUTS = {
    "modernRoads": "data/modern-roads.geojson", "railways": "data/railways.geojson",
    "railwayRoutes": "data/railway-routes.geojson",
    "stations": "data/stations.geojson", "historicalRoads": "data/historical-roads.geojson",
    "historicalPosts": "data/historical-posts.geojson",
}
CACHES = {
    "railways": Path("data/cache/osm/rail/tracks.parquet"),
    "stations": Path("data/cache/osm/rail/stations.parquet"),
    "historicalRoads": Path("data/cache/codh/edo-roads/roads.parquet"),
    "historicalPosts": Path("data/cache/codh/edo-posts/posts.parquet"),
}
RAIL_ROUTES_CACHE = Path("data/cache/osm/rail/routes.parquet")
RAIL_MEMBERS_CACHE = Path("data/cache/osm/rail/route-members.parquet")
RAIL_COLOR_SOURCE = Path("data/sources/railcolors.json")
PREPROCESS = {
    "railways": "python scripts/preprocess/preprocess-rail.py",
    "stations": "python scripts/preprocess/preprocess-rail.py",
    "historicalRoads": "python scripts/preprocess/preprocess-codh.py",
    "historicalPosts": "python scripts/preprocess/preprocess-codh.py",
}

class ProjectBuildError(RuntimeError): pass

def normalize_rail_alias(value: object) -> str:
    """Normalize only compatibility, whitespace, and ASCII case for exact lookup."""
    normalized = " ".join(unicodedata.normalize("NFKC", str(value or "")).strip().split())
    return "".join(character.lower() if "A" <= character <= "Z" else character for character in normalized)

def load_rail_colors(root: Path) -> dict[str, Any]:
    path = root / RAIL_COLOR_SOURCE
    if not path.exists(): raise ProjectBuildError(f"Railway color source missing: {path}")
    document = json.loads(path.read_text(encoding="utf-8"))
    matching = document.get("matching")
    fields = matching.get("fieldsInPriorityOrder") if isinstance(matching, dict) else None
    lines = document.get("lines")
    if (
        not isinstance(document.get("fallbackColor"), str)
        or not isinstance(lines, list)
        or not isinstance(fields, list)
        or not fields
        or not all(isinstance(field, str) for field in fields)
        or any(not isinstance(entry, dict) for entry in lines)
    ):
        raise ProjectBuildError(f"Malformed railway color source: {path}")
    return document

def resolve_rail_color(properties: dict, colors: dict[str, Any]) -> tuple[str, str | None]:
    alias_index: dict[str, list[dict]] = {}
    for entry in colors["lines"]:
        for alias in entry.get("aliases", []):
            normalized = normalize_rail_alias(alias)
            if normalized: alias_index.setdefault(normalized, []).append(entry)
    for field in colors["matching"]["fieldsInPriorityOrder"]:
        # Operator and network are useful display metadata, never line identities.
        if field in {"operator", "network"}:
            continue
        value = normalize_rail_alias(properties.get(field))
        matches = {entry["id"]: entry for entry in alias_index.get(value, [])} if value else {}
        if len(matches) == 1:
            entry = next(iter(matches.values()))
            return entry["color"], entry["id"]
        if len(matches) > 1:
            return colors["fallbackColor"], None
    return colors["fallbackColor"], None

def stamp_rail_color(properties: dict, colors: dict[str, Any]) -> None:
    color, color_id = resolve_rail_color(properties, colors)
    properties["railColor"] = color
    if color_id:
        properties["railColorId"] = color_id
        properties["railDisplayName"] = next(entry["displayName"] for entry in colors["lines"] if entry["id"] == color_id)
    else:
        properties.pop("railColorId", None)

def load_project_config(root: Path, project_id: str) -> dict[str, Any]:
    path = root / "projects" / project_id / "project.json"
    if not path.exists(): raise ProjectBuildError(f"Project config missing: {path}")
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("id") != project_id: raise ProjectBuildError(f"Project id must be {project_id!r}")
    layers = config.get("layers")
    if not isinstance(layers, dict): raise ProjectBuildError("Project layers must be an object")
    unsupported = sorted(set(layers) - SUPPORTED_LAYERS)
    if unsupported: raise ProjectBuildError(f"Unsupported layer family: {', '.join(unsupported)}")
    jurisdiction = config.get("jurisdictionLayer")
    if jurisdiction is not None:
        if not isinstance(jurisdiction, dict): raise ProjectBuildError("jurisdictionLayer must be an object")
        if jurisdiction.get("provider", "geoshape") != "geoshape" or jurisdiction.get("prefecture", "13") != "13":
            raise ProjectBuildError("jurisdictionLayer currently supports only geoshape prefecture 13")
        date = jurisdiction.get("snapshotDate")
        if date is not None and (not isinstance(date, str) or len(date) != 10): raise ProjectBuildError("jurisdictionLayer snapshotDate must be YYYY-MM-DD")
        selection = jurisdiction.get("selection")
        if selection is not None and (not isinstance(selection, dict) or selection.get("level") not in {"municipality", "parent"} or not isinstance(selection.get("value"), str)):
            raise ProjectBuildError("jurisdictionLayer selection must identify a municipality or parent")
    if "stations" in layers and layers["stations"] != {"mode": "bbox"}: raise ProjectBuildError("stations currently supports only mode=bbox")
    if "railways" in layers:
        rail = layers["railways"]
        if rail != {"mode":"bbox"}:
            distance = rail.get("distanceKm") if isinstance(rail, dict) and rail.get("mode") == "near-modern-roads" else None
            if not isinstance(distance, (int,float)) or isinstance(distance,bool) or not math.isfinite(distance) or distance <= 0:
                raise ProjectBuildError("railways must use mode=bbox or near-modern-roads with a positive distanceKm")
    bounds = config.get("bounds")
    if isinstance(bounds, list):
        if len(bounds) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in bounds) or not (-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90):
            raise ProjectBuildError("Malformed bounds: expected [minLon, minLat, maxLon, maxLat] in WGS84")
    elif bounds is not None:
        if not isinstance(bounds, dict) or bounds.get("mode") != "auto":
            raise ProjectBuildError("Malformed bounds: expected a WGS84 bbox or an auto bounds object")
        if bounds.get("from", "modernRoads") != "modernRoads":
            raise ProjectBuildError("Unsupported auto bounds source: 'from' currently only accepts 'modernRoads'")
        padding = bounds.get("paddingKm", 3)
        if not isinstance(padding, (int, float)) or isinstance(padding, bool) or not math.isfinite(padding) or padding <= 0:
            raise ProjectBuildError("Auto bounds paddingKm must be a positive finite number")
    return config

def _collection(features: list[dict]) -> dict: return {"type": "FeatureCollection", "features": features}

def _read_parquet(path: Path, *, bbox=None) -> list[dict]:
    try: import geopandas as gpd
    except ImportError as error: raise ProjectBuildError("GeoParquet support is missing; install requirements-preprocess.txt") from error
    if bbox:
        try:
            frame = gpd.read_parquet(path, bbox=bbox)
        except (TypeError, ValueError, NotImplementedError):
            # Older GeoParquet metadata/readers may not support bbox pushdown.
            # Preserve the same intersection semantics with a bounded in-memory fallback.
            from shapely.geometry import box
            frame = gpd.read_parquet(path)
            frame = frame[frame.geometry.notna() & frame.geometry.intersects(box(*bbox))]
    else:
        frame = gpd.read_parquet(path)
    return json.loads(frame.to_json(drop_id=True))["features"]

def _require_cache(root: Path, family: str) -> Path:
    path = root / CACHES[family]
    if not path.exists(): raise ProjectBuildError(f"Required source cache missing: {path}. Run: {PREPROCESS[family]}")
    return path

def select_modern_roads(root: Path, ids: list[str]) -> list[dict]:
    registry_path = root / "data/roads/registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    entries = {road["id"]: road for road in registry["roads"]}; result = []
    for road_id in ids:
        entry = entries.get(road_id)
        path = root / "public/data/roads" / f"{road_id}-n13.geojson"
        if not entry or not path.exists():
            raise ProjectBuildError(f"Modern road {road_id!r} is not registered and built. Run: python scripts/preprocess/build-road.py {road_id}")
        document = json.loads(path.read_text(encoding="utf-8")); features = document.get("features", [])
        if not features or not any(feature.get("geometry") for feature in features):
            raise ProjectBuildError(f"Built modern road {road_id!r} contains no geometry: {path}. Run: python scripts/preprocess/build-road.py {road_id}")
        presentation_type = entry.get("presentationType", "road")
        if presentation_type not in {"road", "historical-road"}:
            raise ProjectBuildError(f"Road {road_id!r} has invalid presentationType {presentation_type!r}")
        for index, feature in enumerate(features):
            feature["properties"].update(id=road_id if len(features) == 1 else f"{road_id}:{index}", roadId=road_id,
                name=entry["displayName"], aliases=entry.get("aliases", []), entityType="modern-road",
                type=presentation_type, sourceType="canonical-road")
        result.extend(features)
    return result

def select_bbox_features(path: Path, bounds: list[float]) -> list[dict]: return _read_parquet(path, bbox=tuple(bounds))

def select_near_road_routes(path: Path, roads: list[dict], distance_km: float) -> list[dict]:
    """Select on corridor intersection while returning untouched full route features."""
    import geopandas as gpd
    routes = gpd.read_parquet(path)
    road_frame = gpd.GeoDataFrame.from_features(roads, crs="EPSG:4326")
    metric = road_frame.estimate_utm_crs()
    if metric is None: raise ProjectBuildError("Cannot estimate a metric CRS for railway proximity selection")
    corridor = road_frame.to_crs(metric).geometry.buffer(distance_km * 1000).union_all()
    selected = routes.to_crs(metric).geometry.intersects(corridor)
    return json.loads(routes[selected].to_json(drop_id=True))["features"]

def resolve_project_bounds(config: dict[str, Any], modern_road_features: list[dict]) -> tuple[list[float], dict[str, Any]]:
    """Resolve configured bounds, projecting only to calculate metric auto padding."""
    specification = config.get("bounds")
    if isinstance(specification, list):
        return [float(value) for value in specification], {"mode": "explicit"}
    modern_road_ids = config["layers"].get("modernRoads", [])
    if not modern_road_ids:
        raise ProjectBuildError("Cannot derive project bounds automatically because no modernRoads are selected. Specify explicit 'bounds' or add a supported auto-bounds source.")
    auto = specification or {"mode": "auto", "from": "modernRoads", "paddingKm": 3}
    source = auto.get("from", "modernRoads"); padding_km = auto.get("paddingKm", 3)
    if source != "modernRoads":
        raise ProjectBuildError("Unsupported auto bounds source: 'from' currently only accepts 'modernRoads'")
    if not isinstance(padding_km, (int, float)) or isinstance(padding_km, bool) or not math.isfinite(padding_km) or padding_km <= 0:
        raise ProjectBuildError("Auto bounds paddingKm must be a positive finite number")
    if not modern_road_features or not any(feature.get("geometry") for feature in modern_road_features):
        raise ProjectBuildError("Cannot derive project bounds automatically because the selected modernRoads contain no geometry")
    try:
        import geopandas as gpd
        from shapely.geometry import box
        roads = gpd.GeoDataFrame.from_features(modern_road_features, crs="EPSG:4326")
        roads = roads[roads.geometry.notna() & ~roads.geometry.is_empty]
        if roads.empty: raise ValueError("all selected geometries are empty")
        metric_crs = roads.estimate_utm_crs()
        if metric_crs is None: raise ValueError("no suitable metric CRS could be estimated")
        metric_bounds = roads.to_crs(metric_crs).total_bounds
        padded = gpd.GeoSeries([box(*metric_bounds).buffer(float(padding_km) * 1000)], crs=metric_crs).to_crs("EPSG:4326").total_bounds
        resolved = [float(value) for value in padded]
    except ProjectBuildError: raise
    except Exception as error:
        raise ProjectBuildError(f"Cannot derive project bounds automatically from selected modernRoads: {error}") from error
    if len(resolved) != 4 or not all(math.isfinite(value) for value in resolved) or not (-180 <= resolved[0] < resolved[2] <= 180 and -90 <= resolved[1] < resolved[3] <= 90):
        raise ProjectBuildError(f"Automatically computed project bounds are invalid: {resolved}")
    return resolved, {"mode": "auto", "from": "modernRoads", "paddingKm": padding_km, "roadIds": list(modern_road_ids)}

def select_routes(path: Path, route_ids: list[str], family: str) -> list[dict]:
    features = [feature for feature in _read_parquet(path) if feature["properties"].get("routeId") in route_ids]
    found = {f["properties"].get("routeId") for f in features}; missing = sorted(set(route_ids) - found)
    if missing: raise ProjectBuildError(f"Requested {family} route ID absent from cache: {', '.join(missing)}. Run: {PREPROCESS[family]}")
    return features

def _browser_properties(features: list[dict], family: str, rail_colors: dict[str, Any] | None = None) -> None:
    for index, feature in enumerate(features):
        p = feature["properties"]
        if family == "railways":
            p.update(id=f"rail:{p.get('osm_element_type','way')}:{p.get('osm_element_id',index)}", type="railway")
            group = rail_group_properties(p)
            if group: p.update(group)
            if rail_colors: stamp_rail_color(p, rail_colors)
        elif family == "railwayRoutes":
            p.update(id=p["railRouteId"], name=p.get("name:ja") or p.get("name") or p.get("ref") or p["railRouteId"], type="railway", railDisplayName=p.get("name:ja") or p.get("name") or p.get("ref") or p["railRouteId"])
            if rail_colors: stamp_rail_color(p, rail_colors)
        elif family == "stations": p.update(id=f"station:{p.get('osm_element_type','element')}:{p.get('osm_element_id',index)}", name=p.get("name:ja") or p.get("name") or "名称不明駅", type="station")
        elif family == "historicalRoads": p.update(id=f"historical-road:{p['routeId']}:{index}", type="historical-road")
        elif family == "historicalPosts": p.update(id=f"historical-post:{p['postId']}", name=p.get("name") or p.get("historicalLabel") or p["postId"], type="historical-place")

def rail_group_properties(properties: dict) -> dict | None:
    """Derive a conservative, exact-tag physical-track grouping for the browser."""
    wikidata = str(properties.get("wikidata") or "").strip()
    name = str(properties.get("name:ja") or properties.get("name") or "").strip()
    ref = str(properties.get("ref") or "").strip()
    qualifier = str(properties.get("operator") or properties.get("network") or "").strip()
    if wikidata:
        key, display = f"wikidata:{wikidata}", name or ref or wikidata
    elif name and qualifier:
        key, display = f"name:{name}:{qualifier}", name
    elif ref and qualifier:
        key, display = f"ref:{ref}:{qualifier}", name or ref
    else:
        return None
    return {"railGroupId": "rail:" + quote(key, safe=":"), "railDisplayName": display}


def _rail_search(features: list[dict], routes: list[dict] | None = None) -> list[dict]:
    result=[]
    for route in routes or []:
        p=route["properties"]; display=p.get("name:ja") or p.get("name") or p.get("ref") or p["railRouteId"]
        aliases=[v for v in (p.get("name"),p.get("name:ja"),p.get("name:en"),p.get("ref"),p.get("operator"),p.get("network")) if v and v != display]
        result.append({"id":p["railRouteId"],"entityType":"railway","displayName":display,"aliases":list(dict.fromkeys(aliases)),"searchTerms":list(dict.fromkeys([display,*aliases])),"source":"osm","geometryHint":"MultiLineString","railRouteId":p["railRouteId"],"identitySource":"route-relation","geometry":route["geometry"]})
    member_way_ids={str(way) for route in routes or [] for way in route["properties"].get("memberWayIds",[])}
    groups = {}
    for feature in features:
        p = feature["properties"]
        if str(p.get("osm_way_id") or p.get("osm_element_id")) in member_way_ids: continue
        if p.get("railGroupId") and p.get("railDisplayName"):
            groups.setdefault(p["railGroupId"], []).append(feature)
    for group_id, members in groups.items():
        first = members[0]["properties"]
        lines = []
        for member in members:
            geometry = member["geometry"]
            lines.extend(geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]])
        aliases = [value for value in (first.get("name:en"), first.get("ref"), first.get("operator"), first.get("network")) if value and value != first["railDisplayName"]]
        result.append({"id": group_id, "entityType":"railway", "displayName":first["railDisplayName"],
                       "aliases":list(dict.fromkeys(aliases)), "searchTerms":list(dict.fromkeys([first["railDisplayName"], *aliases])),
                       "source":"osm", "geometryHint":"MultiLineString", "railGroupId":group_id, "identitySource":"exact-track-tags",
                       "geometry":{"type":"MultiLineString", "coordinates":lines}})
    return result


def build_search(features_by_family: dict[str, list[dict]]) -> list[dict]:
    entries = []
    for family in ("modernRoads", "stations", "historicalRoads", "historicalPosts"):
        for feature in features_by_family.get(family, []):
            p, geometry = feature["properties"], feature["geometry"]
            aliases = [v for v in [*(p.get("aliases") or []), p.get("name:ja"), p.get("altName"), p.get("historicalLabel"), p.get("routeId"), p.get("postId")] if v and v != p.get("name")]
            entries.append({"id": p["id"], "entityType": {"modernRoads":"modern-road", "stations":"railway-station", "historicalRoads":"historical-road", "historicalPosts":"historical-post"}[family], "displayName": p["name"], "aliases": list(dict.fromkeys(aliases)), "searchTerms": list(dict.fromkeys([p["name"], *aliases])), **({"routeId": p["routeId"]} if p.get("routeId") else {}), "source": p.get("sourceType"), "geometryHint": geometry["type"]})
    return entries + _rail_search(features_by_family.get("railways", []), features_by_family.get("railwayRoutes", []))

def materialize_project(root: Path, project_id: str, output_root: Path | None = None) -> dict:
    config = load_project_config(root, project_id); layers = config["layers"]
    features: dict[str, list[dict]] = {}
    builder_roads = select_modern_roads(root, layers.get("modernRoads", []))
    custom_historical = [feature for feature in builder_roads if feature["properties"]["type"] == "historical-road"]
    if "modernRoads" in layers:
        features["modernRoads"] = [feature for feature in builder_roads if feature["properties"]["type"] == "road"]
    bounds, bounds_source = resolve_project_bounds(config, builder_roads)
    if "railways" in layers:
        features["railways"] = select_bbox_features(_require_cache(root, "railways"), bounds)
        route_path, member_path = root / RAIL_ROUTES_CACHE, root / RAIL_MEMBERS_CACHE
        if not route_path.exists() or not member_path.exists(): raise ProjectBuildError(f"Required railway relation caches missing. Run: {PREPROCESS['railways']}")
        rail_config=layers["railways"]
        features["railwayRoutes"] = (_read_parquet(route_path, bbox=tuple(bounds)) if rail_config["mode"] == "bbox" else select_near_road_routes(route_path, builder_roads, rail_config["distanceKm"]))
        selected_ids={route["properties"]["railRouteId"] for route in features["railwayRoutes"]}
        memberships=[m for m in _read_parquet(member_path) if m["properties"].get("railRouteId") in selected_ids]
        by_route={route_id:[] for route_id in selected_ids}; by_way={}
        for membership in memberships:
            p=membership["properties"]; way=str(p["osm_way_id"]); by_route[p["railRouteId"]].append(way); by_way.setdefault(way,[]).append(p["railRouteId"])
        for route in features["railwayRoutes"]: route["properties"]["memberWayIds"]=by_route.get(route["properties"]["railRouteId"],[])
        for track in features["railways"]: track["properties"]["railRouteIds"]=by_way.get(str(track["properties"].get("osm_way_id") or track["properties"].get("osm_element_id")),[])
    if "stations" in layers: features["stations"] = select_bbox_features(_require_cache(root, "stations"), bounds)
    for family in ("historicalRoads", "historicalPosts"):
        if family in layers: features[family] = select_routes(_require_cache(root, family), layers[family], family)
    rail_colors = load_rail_colors(root) if "railways" in layers else None
    for family, selected in features.items(): _browser_properties(selected, family, rail_colors)
    if custom_historical:
        features.setdefault("historicalRoads", []).extend(custom_historical)
    output = output_root or root / "public/projects" / project_id
    (output / "data").mkdir(parents=True, exist_ok=True); (output / "search").mkdir(parents=True, exist_ok=True)
    (output / "project.json").write_text(json.dumps(config, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    for family, relative in OUTPUTS.items():
        (output / relative).write_text(json.dumps(_collection(features.get(family, [])), ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
    search = build_search(features); (output / "search/entities.json").write_text(json.dumps(search, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    counts = {"modernRoads": len(features.get("modernRoads", [])), "railwayTracks": len(features.get("railways", [])), "railwayRoutes":len(features.get("railwayRoutes",[])), "stations": len(features.get("stations", [])), "historicalRoadFeatures": len(features.get("historicalRoads", [])), "historicalPosts": len(features.get("historicalPosts", []))}
    manifest = {"projectId": project_id, "builtAt": datetime.now(timezone.utc).isoformat(), "bounds": bounds, "boundsSource": bounds_source, "railwaySelection":layers.get("railways"), "sourceLayerFamilies": list(layers), "featureCounts": counts, "inputs": {family: str(path) for family, path in CACHES.items() if family in layers}, "outputs": {**OUTPUTS, "search": "search/entities.json"}}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    return manifest
