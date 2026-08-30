"""Materialize small, static browser bundles from reusable source caches."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

SUPPORTED_LAYERS = {"modernRoads", "railways", "stations", "historicalRoads", "historicalPosts"}
OUTPUTS = {
    "modernRoads": "data/modern-roads.geojson", "railways": "data/railways.geojson",
    "stations": "data/stations.geojson", "historicalRoads": "data/historical-roads.geojson",
    "historicalPosts": "data/historical-posts.geojson",
}
CACHES = {
    "railways": Path("data/cache/osm/rail/tracks.parquet"),
    "stations": Path("data/cache/osm/rail/stations.parquet"),
    "historicalRoads": Path("data/cache/codh/edo-roads/roads.parquet"),
    "historicalPosts": Path("data/cache/codh/edo-posts/posts.parquet"),
}
PREPROCESS = {
    "railways": "python scripts/preprocess/preprocess-rail.py",
    "stations": "python scripts/preprocess/preprocess-rail.py",
    "historicalRoads": "python scripts/preprocess/preprocess-codh.py",
    "historicalPosts": "python scripts/preprocess/preprocess-codh.py",
}

class ProjectBuildError(RuntimeError): pass

def load_project_config(root: Path, project_id: str) -> dict[str, Any]:
    path = root / "projects" / project_id / "project.json"
    if not path.exists(): raise ProjectBuildError(f"Project config missing: {path}")
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("id") != project_id: raise ProjectBuildError(f"Project id must be {project_id!r}")
    bounds = config.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4 or not all(isinstance(v, (int, float)) for v in bounds) or not (-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90):
        raise ProjectBuildError("Malformed bounds: expected [minLon, minLat, maxLon, maxLat] in WGS84")
    layers = config.get("layers")
    if not isinstance(layers, dict): raise ProjectBuildError("Project layers must be an object")
    unsupported = sorted(set(layers) - SUPPORTED_LAYERS)
    if unsupported: raise ProjectBuildError(f"Unsupported layer family: {', '.join(unsupported)}")
    for family in ("railways", "stations"):
        if family in layers and layers[family] != {"mode": "bbox"}: raise ProjectBuildError(f"{family} currently supports only mode=bbox")
    return config

def _collection(features: list[dict]) -> dict: return {"type": "FeatureCollection", "features": features}

def _read_parquet(path: Path, *, bbox=None) -> list[dict]:
    try: import geopandas as gpd
    except ImportError as error: raise ProjectBuildError("GeoParquet support is missing; install requirements-preprocess.txt") from error
    frame = gpd.read_parquet(path, bbox=bbox) if bbox else gpd.read_parquet(path)
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
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
        if not features: raise ProjectBuildError(f"Built modern road {road_id!r} contains no features: {path}")
        for index, feature in enumerate(features):
            feature["properties"].update(id=road_id if len(features) == 1 else f"{road_id}:{index}", roadId=road_id,
                name=entry["displayName"], aliases=entry.get("aliases", []), entityType="modern-road", type="road", sourceType="canonical-road")
        result.extend(features)
    return result

def select_bbox_features(path: Path, bounds: list[float]) -> list[dict]: return _read_parquet(path, bbox=tuple(bounds))

def select_routes(path: Path, route_ids: list[str], family: str) -> list[dict]:
    features = [feature for feature in _read_parquet(path) if feature["properties"].get("routeId") in route_ids]
    found = {f["properties"].get("routeId") for f in features}; missing = sorted(set(route_ids) - found)
    if missing: raise ProjectBuildError(f"Requested {family} route ID absent from cache: {', '.join(missing)}. Run: {PREPROCESS[family]}")
    return features

def _browser_properties(features: list[dict], family: str) -> None:
    for index, feature in enumerate(features):
        p = feature["properties"]
        if family == "railways": p.update(id=f"rail:{p.get('osm_element_type','way')}:{p.get('osm_element_id',index)}", type="railway")
        elif family == "stations": p.update(id=f"station:{p.get('osm_element_type','element')}:{p.get('osm_element_id',index)}", name=p.get("name:ja") or p.get("name") or "名称不明駅", type="station")
        elif family == "historicalRoads": p.update(id=f"historical-road:{p['routeId']}:{index}", type="historical-road")
        elif family == "historicalPosts": p.update(id=f"historical-post:{p['postId']}", name=p.get("name") or p.get("historicalLabel") or p["postId"], type="historical-place")

def build_search(features_by_family: dict[str, list[dict]]) -> list[dict]:
    entries = []
    for family in ("modernRoads", "stations", "historicalRoads", "historicalPosts"):
        for feature in features_by_family.get(family, []):
            p, geometry = feature["properties"], feature["geometry"]
            aliases = [v for v in [*(p.get("aliases") or []), p.get("name:ja"), p.get("altName"), p.get("historicalLabel"), p.get("routeId"), p.get("postId")] if v and v != p.get("name")]
            entries.append({"id": p["id"], "entityType": {"modernRoads":"modern-road", "stations":"railway-station", "historicalRoads":"historical-road", "historicalPosts":"historical-post"}[family], "displayName": p["name"], "aliases": list(dict.fromkeys(aliases)), "searchTerms": list(dict.fromkeys([p["name"], *aliases])), **({"routeId": p["routeId"]} if p.get("routeId") else {}), "source": p.get("sourceType"), "geometryHint": geometry["type"]})
    return entries

def materialize_project(root: Path, project_id: str, output_root: Path | None = None) -> dict:
    config = load_project_config(root, project_id); layers = config["layers"]; bounds = config["bounds"]
    features: dict[str, list[dict]] = {}
    if "modernRoads" in layers: features["modernRoads"] = select_modern_roads(root, layers["modernRoads"])
    for family in ("railways", "stations"):
        if family in layers: features[family] = select_bbox_features(_require_cache(root, family), bounds)
    for family in ("historicalRoads", "historicalPosts"):
        if family in layers: features[family] = select_routes(_require_cache(root, family), layers[family], family)
    for family, selected in features.items(): _browser_properties(selected, family)
    output = output_root or root / "public/projects" / project_id
    (output / "data").mkdir(parents=True, exist_ok=True); (output / "search").mkdir(parents=True, exist_ok=True)
    (output / "project.json").write_text(json.dumps(config, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    for family, relative in OUTPUTS.items():
        (output / relative).write_text(json.dumps(_collection(features.get(family, [])), ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
    search = build_search(features); (output / "search/entities.json").write_text(json.dumps(search, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    counts = {"modernRoads": len(features.get("modernRoads", [])), "railwayTracks": len(features.get("railways", [])), "stations": len(features.get("stations", [])), "historicalRoadFeatures": len(features.get("historicalRoads", [])), "historicalPosts": len(features.get("historicalPosts", []))}
    manifest = {"projectId": project_id, "builtAt": datetime.now(timezone.utc).isoformat(), "bounds": bounds, "sourceLayerFamilies": list(layers), "featureCounts": counts, "inputs": {family: str(path) for family, path in CACHES.items() if family in layers}, "outputs": {**OUTPUTS, "search": "search/entities.json"}}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    return manifest
