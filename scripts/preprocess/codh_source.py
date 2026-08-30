"""Acquire and normalize CODH Edo major-road and post-station layers."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import shutil
import urllib.request
import zipfile

from source_normalization import load_features, normalize_wgs84, write_dataset, write_json

ROUTE_KEYS = ("route_id", "routeId", "RouteID", "ROUTE_ID", "road_id", "roadId", "RoadID", "ROAD_ID", "route", "路線ID", "路線コード", "街道ID")
NAME_KEYS = ("name", "Name", "name_ja", "road_name", "ROAD_NAME", "路線名", "街道名", "名称", "宿場名")
ID_KEYS = ("post_id", "postId", "PostID", "station_id", "id", "ID", "宿場ID")
ROUTE_PATTERN = re.compile(r"^R\d{3}(?:-\d+)?$")
FIVE_HIGHWAYS = {"R001", "R002", "R003", "R004", "R005"}


def first(properties: dict, keys) -> object | None:
    return next((properties[key] for key in keys if properties.get(key) not in (None, "")), None)


def route_id(properties: dict) -> str:
    value = first(properties, ROUTE_KEYS)
    # The official road layer uses ID for its route identifier; on the post
    # layer ID is the post identifier, so accept it only when it has route syntax.
    if value is None and ROUTE_PATTERN.fullmatch(str(properties.get("ID", "")).strip()):
        value = properties["ID"]
    if value is None:
        raise ValueError(f"feature has no route ID in supported fields {ROUTE_KEYS}")
    value = str(value).strip()
    if not ROUTE_PATTERN.fullmatch(value):
        raise ValueError(f"invalid CODH route ID {value!r}")
    return value


def normalize_roads(features: list[dict], source_crs: str) -> list[dict]:
    result = []
    for feature in normalize_wgs84(features, source_crs):
        if feature["geometry"]["type"] not in {"LineString", "MultiLineString"}:
            continue
        original = feature.get("properties", {}); rid = route_id(original)
        properties = {"routeId": rid, "name": first(original, NAME_KEYS), "sourceFeatureId": feature.get("id") or first(original, ID_KEYS),
                      "sourceType": "codh", "entityType": "historical-road", "geometryType": feature["geometry"]["type"], "originalProperties": json.dumps(original, ensure_ascii=False, sort_keys=True)}
        result.append({"type": "Feature", "properties": {k: v for k, v in properties.items() if v is not None}, "geometry": feature["geometry"]})
    return result


def normalize_posts(features: list[dict], source_crs: str) -> list[dict]:
    result = []
    for feature in normalize_wgs84(features, source_crs):
        if feature["geometry"]["type"] != "Point":
            continue
        original = feature.get("properties", {}); rid = route_id(original)
        properties = {"routeId": rid, "postId": feature.get("id") or first(original, ID_KEYS), "name": first(original, NAME_KEYS),
                      "sourceType": "codh", "entityType": "historical-post", "geometryType": "Point", "originalProperties": json.dumps(original, ensure_ascii=False, sort_keys=True)}
        result.append({"type": "Feature", "properties": {k: v for k, v in properties.items() if v is not None}, "geometry": feature["geometry"]})
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


def download(path: Path, url: str, refresh: bool, opener=urllib.request.urlopen) -> bool:
    """Atomically cache a configured official download; return whether downloaded."""
    if path.exists() and not refresh:
        return False
    path.parent.mkdir(parents=True, exist_ok=True); temporary = path.with_suffix(path.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "michi-app-source-preprocessor/1.0"})
    with opener(request, timeout=360) as response, temporary.open("wb") as target:
        shutil.copyfileobj(response, target)
    temporary.replace(path)
    return True


def extract_configured_archive(archive: Path, output: Path, member: str) -> Path:
    """Extract exactly the configured member, rejecting ambiguous/arbitrary layers."""
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        matches = [name for name in source.namelist() if name == member or Path(name).name == member]
        if len(matches) != 1:
            raise RuntimeError(f"{archive} must contain exactly one configured member {member!r}; found {matches}")
        target = output / Path(member).name
        with source.open(matches[0]) as incoming, target.open("wb") as outgoing:
            shutil.copyfileobj(incoming, outgoing)
    return target


def prepare_source(config: dict, refresh: bool, override: Path | None = None, opener=urllib.request.urlopen) -> tuple[Path, str | None, dict]:
    """Download/cache and deterministically prepare one configured dataset."""
    raw = Path(override) if override else Path(config["rawPath"])
    if not override:
        download(raw, config["downloadUrl"], refresh, opener)
    if raw.suffix.lower() == ".zip":
        extracted = raw.parent / "extracted" / raw.stem
        source = extract_configured_archive(raw, extracted, config["archiveMember"])
    else:
        source = raw
    return source, config.get("layer"), {"rawPath": str(raw), "sourceFormat": raw.suffix.lstrip(".").upper(), "archiveMember": config.get("archiveMember")}


def run(roads_source: Path, posts_source: Path, roads_output: Path, posts_output: Path, metadata: dict,
        extension=".parquet", roads_layer=None, posts_layer=None, source_details=None) -> tuple[dict, dict]:
    road_features, roads_crs, road_info = load_features(roads_source, roads_layer)
    post_features, posts_crs, post_info = load_features(posts_source, posts_layer)
    # Container formats are reprojected by load_features while retaining their
    # original CRS in manifest metadata. GeoJSON fixtures normalize here.
    roads_input_crs = "EPSG:4326" if roads_source.suffix.lower() not in {".json", ".geojson"} else roads_crs
    posts_input_crs = "EPSG:4326" if posts_source.suffix.lower() not in {".json", ".geojson"} else posts_crs
    roads = normalize_roads(road_features, roads_input_crs); posts = normalize_posts(post_features, posts_input_crs)
    road_path, post_path = roads_output / f"roads{extension}", posts_output / f"posts{extension}"
    write_dataset(roads, road_path); write_dataset(posts, post_path)
    road_groups, post_counts = defaultdict(list), Counter(p["properties"]["routeId"] for p in posts)
    for road in roads:
        road_groups[road["properties"]["routeId"]].append(road)
    acquired_at = datetime.now(timezone.utc).isoformat(); source_details = source_details or ({}, {})
    def provenance(config, source, crs, info, details):
        return {"datasetName": config["datasetName"], "provider": metadata["provider"], "landingPage": config["landingPage"],
                "downloadUrl": config["downloadUrl"], "sourceUrl": config["downloadUrl"], "sourcePath": str(source),
                "rawPath": details.get("rawPath", str(source)), "sourceFormat": details.get("sourceFormat", info["sourceFormat"]),
                "sourceLayers": info["sourceLayers"], "archiveMember": details.get("archiveMember"), "sourceCrs": crs,
                "normalizedCrs": metadata["normalizedCrs"], "license": config["license"], "licenseUrl": config["licenseUrl"],
                "attribution": config["attribution"], "acquiredAt": acquired_at}
    road_manifest = {**provenance(metadata["roads"], roads_source, roads_crs, road_info, source_details[0]), "featureCount": len(roads), "routeIdsPresent": sorted(road_groups), "routeStatistics": {rid: {"featureCount": len(fs), "lengthKm": round(sum(line_length_km(f["geometry"]) for f in fs), 3)} for rid, fs in sorted(road_groups.items())}, "outputs": {"roads": str(road_path), "index": str(roads_output / "index.json")}}
    post_manifest = {**provenance(metadata["posts"], posts_source, posts_crs, post_info, source_details[1]), "featureCount": len(posts), "routeIdsPresent": sorted(post_counts), "countsByRouteId": dict(sorted(post_counts.items())), "outputs": {"posts": str(post_path), "index": str(posts_output / "index.json")}}
    road_index = [{"id": rid, "displayName": next((f["properties"].get("name") for f in fs if f["properties"].get("name")), rid), "entityType": "historical-road", "featureCount": len(fs)} for rid, fs in sorted(road_groups.items())]
    post_index = [{"routeId": rid, "entityType": "historical-post", "count": count} for rid, count in sorted(post_counts.items())]
    write_json(roads_output / "manifest.json", road_manifest); write_json(roads_output / "index.json", road_index)
    write_json(posts_output / "manifest.json", post_manifest); write_json(posts_output / "index.json", post_index)
    return road_manifest, post_manifest


def summary(road_manifest: dict, post_manifest: dict) -> dict:
    route_ids = road_manifest["routeIdsPresent"]
    return {"roadCount": road_manifest["featureCount"], "postCount": post_manifest["featureCount"],
            "roadRouteIdCount": len(route_ids), "fiveHighwaysPresent": sorted(FIVE_HIGHWAYS.intersection(route_ids)),
            "sampleBranchRouteIds": [rid for rid in route_ids if "-" in rid][:10], "manifests": [road_manifest, post_manifest]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--config", type=Path, default=Path("data/sources/codh.json"))
    parser.add_argument("--roads", type=Path); parser.add_argument("--posts", type=Path); parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args(); metadata = json.loads(args.config.read_text(encoding="utf-8"))
    roads, roads_layer, road_details = prepare_source(metadata["roads"], args.refresh, args.roads)
    posts, posts_layer, post_details = prepare_source(metadata["posts"], args.refresh, args.posts)
    manifests = run(roads, posts, Path("data/cache/codh/edo-roads"), Path("data/cache/codh/edo-posts"), metadata,
                    roads_layer=roads_layer, posts_layer=posts_layer, source_details=(road_details, post_details))
    print(json.dumps(summary(*manifests), ensure_ascii=False, indent=2))
