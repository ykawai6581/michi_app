"""Normalize CODH Edo major-road and post-station source layers."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import urllib.request

from source_normalization import load_features, normalize_wgs84, write_dataset, write_json

ROUTE_KEYS = ("route_id", "routeId", "ROUTE_ID", "road_id", "roadId", "ROAD_ID", "route", "路線ID", "路線コード", "街道ID")
NAME_KEYS = ("name", "name_ja", "road_name", "ROAD_NAME", "路線名", "街道名", "宿場名")
ID_KEYS = ("post_id", "station_id", "id", "ID", "宿場ID")
ROUTE_PATTERN = re.compile(r"^R\d{3}$")


def first(properties: dict, keys) -> object | None:
    return next((properties[key] for key in keys if properties.get(key) not in (None, "")), None)


def route_id(properties: dict) -> str:
    value = first(properties, ROUTE_KEYS)
    if value is None:
        raise ValueError(f"feature has no route ID in supported fields {ROUTE_KEYS}")
    value = str(value).strip()
    if not ROUTE_PATTERN.match(value): raise ValueError(f"invalid CODH route ID {value!r}")
    return value


def normalize_roads(features: list[dict], source_crs: str) -> list[dict]:
    result = []
    for feature in normalize_wgs84(features, source_crs):
        if feature["geometry"]["type"] not in {"LineString", "MultiLineString"}: continue
        original = feature.get("properties", {}); rid = route_id(original)
        properties = {"routeId": rid, "name": first(original, NAME_KEYS), "sourceFeatureId": feature.get("id") or first(original, ID_KEYS),
                      "sourceType": "codh", "entityType": "historical-road", "geometryType": feature["geometry"]["type"], "originalProperties": json.dumps(original, ensure_ascii=False, sort_keys=True)}
        result.append({"type": "Feature", "properties": {k:v for k,v in properties.items() if v is not None}, "geometry": feature["geometry"]})
    return result


def normalize_posts(features: list[dict], source_crs: str) -> list[dict]:
    result = []
    for feature in normalize_wgs84(features, source_crs):
        if feature["geometry"]["type"] != "Point": continue
        original = feature.get("properties", {}); rid = route_id(original)
        properties = {"routeId": rid, "postId": feature.get("id") or first(original, ID_KEYS), "name": first(original, NAME_KEYS),
                      "sourceType": "codh", "entityType": "historical-post", "geometryType": "Point", "originalProperties": json.dumps(original, ensure_ascii=False, sort_keys=True)}
        result.append({"type": "Feature", "properties": {k:v for k,v in properties.items() if v is not None}, "geometry": feature["geometry"]})
    return result


def line_length_km(geometry: dict) -> float:
    lines = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
    total = 0.0
    for line in lines:
        for a, b in zip(line, line[1:]):
            p1, p2 = math.radians(a[1]), math.radians(b[1]); dp, dl = p2-p1, math.radians(b[0]-a[0])
            h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
            total += 6371.0088 * 2 * math.asin(min(1, math.sqrt(h)))
    return total


def run(roads_source: Path, posts_source: Path, roads_output: Path, posts_output: Path, metadata: dict, extension=".parquet") -> tuple[dict, dict]:
    road_features, roads_crs = load_features(roads_source); post_features, posts_crs = load_features(posts_source)
    roads = normalize_roads(road_features, roads_crs); posts = normalize_posts(post_features, posts_crs)
    road_path, post_path = roads_output / f"roads{extension}", posts_output / f"posts{extension}"
    write_dataset(roads, road_path); write_dataset(posts, post_path)
    road_groups, post_counts = defaultdict(list), Counter(p["properties"]["routeId"] for p in posts)
    for road in roads: road_groups[road["properties"]["routeId"]].append(road)
    common = {"provider": metadata["provider"], "datasetLandingPage": metadata["datasetLandingPage"], "license": metadata["license"], "attribution": metadata["attribution"], "acquiredAt": datetime.now(timezone.utc).isoformat(), "normalizedCrs": "EPSG:4326"}
    road_manifest = {**common, "datasetName": "CODH Edo major roads", "sourceUrl": metadata["roads"]["sourceUrl"], "sourcePath": str(roads_source), "sourceCrs": roads_crs, "featureCount": len(roads), "routeIdsPresent": sorted(road_groups), "routeStatistics": {rid: {"featureCount": len(fs), "lengthKm": round(sum(line_length_km(f["geometry"]) for f in fs), 3)} for rid,fs in sorted(road_groups.items())}, "outputs": {"roads": str(road_path), "index": str(roads_output / "index.json")}}
    post_manifest = {**common, "datasetName": "CODH Edo post stations (宿場)", "sourceUrl": metadata["posts"]["sourceUrl"], "sourcePath": str(posts_source), "sourceCrs": posts_crs, "featureCount": len(posts), "routeIdsPresent": sorted(post_counts), "countsByRouteId": dict(sorted(post_counts.items())), "outputs": {"posts": str(post_path), "index": str(posts_output / "index.json")}}
    road_index = [{"id": rid, "displayName": next((f["properties"].get("name") for f in fs if f["properties"].get("name")), rid), "entityType": "historical-road", "featureCount": len(fs)} for rid,fs in sorted(road_groups.items())]
    post_index = [{"routeId": rid, "entityType": "historical-post", "count": count} for rid,count in sorted(post_counts.items())]
    write_json(roads_output / "manifest.json", road_manifest); write_json(roads_output / "index.json", road_index)
    write_json(posts_output / "manifest.json", post_manifest); write_json(posts_output / "index.json", post_index)
    return road_manifest, post_manifest


def obtain(path: Path, url: str, refresh: bool) -> None:
    if path.exists() and not refresh: return
    if url.endswith("/"): raise RuntimeError(f"No stable direct download URL is configured for {path}; download from {url} or pass --roads/--posts")
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "michi-app-source-preprocessor/1.0"})
    path.write_bytes(urllib.request.urlopen(request, timeout=360).read())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--config", type=Path, default=Path("data/sources/codh.json"))
    parser.add_argument("--roads", type=Path); parser.add_argument("--posts", type=Path); parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args(); metadata = json.loads(args.config.read_text(encoding="utf-8"))
    roads = args.roads or Path(metadata["roads"]["rawPath"]); posts = args.posts or Path(metadata["posts"]["rawPath"])
    obtain(roads, metadata["roads"]["sourceUrl"], args.refresh); obtain(posts, metadata["posts"]["sourceUrl"], args.refresh)
    manifests = run(roads, posts, Path("data/cache/codh/edo-roads"), Path("data/cache/codh/edo-posts"), metadata)
    print(json.dumps(manifests, ensure_ascii=False, indent=2))
