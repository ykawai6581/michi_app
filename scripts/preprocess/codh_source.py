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

ROUTE_KEYS = ("numbering", "road_id", "route_id", "routeId", "RouteID", "ROUTE_ID", "roadId", "RoadID", "ROAD_ID", "route", "路線ID", "路線コード", "街道ID")
NAME_KEYS = ("name", "Name", "name_ja", "road_name", "ROAD_NAME", "路線名", "街道名", "名称", "宿場名")
ROUTE_PATTERN = re.compile(r"^R\d{3}(?:-\d+)?$")
FIVE_HIGHWAYS = {"R001", "R002", "R003", "R004", "R005"}


def first(properties: dict, keys) -> object | None:
    return next((properties[key] for key in keys if properties.get(key) not in (None, "")), None)


def route_id(properties: dict) -> str:
    value = first(properties, ROUTE_KEYS)
    # Compatibility with earlier exports that used ID for a route: the current
    # post layer's id is a post identity, so accept ID only when it has route syntax.
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
        properties = {"routeId": rid, "name": original.get("name") or first(original, NAME_KEYS),
                      "altName": original.get("alt_name"), "start": original.get("start"), "end": original.get("end"),
                      "sourceType": "codh", "entityType": "historical-road", "geometryType": feature["geometry"]["type"], "originalProperties": json.dumps(original, ensure_ascii=False, sort_keys=True)}
        result.append({"type": "Feature", "properties": {k: v for k, v in properties.items() if v is not None}, "geometry": feature["geometry"]})
    return result


def normalize_posts(features: list[dict], source_crs: str) -> list[dict]:
    result = []; seen = {}
    for feature in normalize_wgs84(features, source_crs):
        if feature["geometry"]["type"] != "Point":
            continue
        original = feature.get("properties", {}); rid = route_id(original)
        post_id = original.get("id")
        if not post_id:
            raise ValueError("CODH post feature has no source id")
        signature = json.dumps({"properties": original, "geometry": feature["geometry"]}, ensure_ascii=False, sort_keys=True)
        if post_id in seen:
            if seen[post_id] != signature:
                raise ValueError(f"conflicting CODH post features share source id {post_id!r}")
            continue
        seen[post_id] = signature
        properties = {"routeId": rid, "postId": post_id, "name": original.get("name"),
                      "historicalLabel": original.get("jk"), "historicalPlaceId": original.get("jk_id"),
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


def inspect_geopackage(path: Path, pyogrio_module=None) -> list[str]:
    """Open a GeoPackage and return its named layers."""
    if pyogrio_module is None:
        try:
            import pyogrio as pyogrio_module
        except ImportError as error:
            raise RuntimeError("Pyogrio is required to validate the CODH GeoPackage") from error
    layers = [str(row[0]) for row in pyogrio_module.list_layers(path)]
    if not layers:
        raise ValueError("GeoPackage contains no readable layers")
    return layers


def validate_source(path: Path, expected: str, content_type: str | None = None,
                    gpkg_inspector=inspect_geopackage) -> list[str]:
    """Validate a downloaded container or extracted payload by its actual format."""
    with path.open("rb") as source:
        prefix = source.read(512).lstrip().lower()
    if prefix.startswith((b"<!doctype html", b"<html")) or "text/html" in (content_type or "").lower():
        raise ValueError("response is an HTML document, not source data")
    if expected == "geojson":
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError(f"response is not valid JSON: {error}") from error
        if document.get("type") != "FeatureCollection" or not isinstance(document.get("features"), list):
            raise ValueError("JSON is not a GeoJSON FeatureCollection")
        return []
    if expected == "geopackage":
        if not prefix.startswith(b"sqlite format 3\x00"):
            raise ValueError("response does not have a GeoPackage/SQLite header")
        return gpkg_inspector(path)
    if expected == "zip":
        if not zipfile.is_zipfile(path):
            raise ValueError("response is not a ZIP archive")
        return []
    raise ValueError(f"unsupported configured source format {expected!r}")


def download(config: dict, refresh: bool, opener=urllib.request.urlopen,
             gpkg_inspector=inspect_geopackage) -> dict:
    """Atomically download and validate one configured official dataset."""
    path, url = Path(config["rawPath"]), config["downloadUrl"]
    if path.exists() and not refresh:
        layers = validate_source(path, config["format"], gpkg_inspector=gpkg_inspector)
        return {"downloaded": False, "finalResponseUrl": None, "responseStatus": None,
                "responseContentType": None, "sourceLayers": layers}
    path.parent.mkdir(parents=True, exist_ok=True); temporary = path.with_suffix(path.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "michi-app-source-preprocessor/1.0"})
    try:
        with opener(request, timeout=360) as response, temporary.open("wb") as target:
            status = getattr(response, "status", None) or getattr(response, "getcode", lambda: None)()
            content_type = response.headers.get("Content-Type") if getattr(response, "headers", None) else None
            final_url = getattr(response, "geturl", lambda: url)()
            if status is not None and not 200 <= int(status) < 300:
                raise ValueError(f"HTTP response status is {status}, not a success status")
            shutil.copyfileobj(response, target)
        layers = validate_source(temporary, config["format"], content_type, gpkg_inspector)
        temporary.replace(path)
        return {"downloaded": True, "finalResponseUrl": final_url, "responseStatus": status,
                "responseContentType": content_type, "sourceLayers": layers}
    except Exception as error:
        temporary.unlink(missing_ok=True)
        failure_status = getattr(error, "code", locals().get("status"))
        failure_headers = getattr(error, "headers", None)
        failure_content_type = (failure_headers.get("Content-Type") if failure_headers else None) or locals().get("content_type")
        raise RuntimeError(
            f"Failed to acquire {config['datasetName']} from {url}: expected {config['format']}; "
            f"status={failure_status!r}, content-type={failure_content_type!r}: {error}"
        ) from error


def select_archive_member(archive: Path, configured_member: str | None = None) -> tuple[str, list[str]]:
    """Select a configured GeoPackage member, or the sole plausible member."""
    with zipfile.ZipFile(archive) as source:
        members = source.namelist()
    candidates = [name for name in members if not name.endswith("/") and name.lower().endswith(".gpkg")]
    if configured_member:
        if configured_member not in members:
            raise RuntimeError(f"{archive} is missing configured archiveMember {configured_member!r}; available members: {members}")
        if not configured_member.lower().endswith(".gpkg"):
            raise RuntimeError(f"configured archiveMember {configured_member!r} is not a GeoPackage")
        return configured_member, members
    if len(candidates) != 1:
        reason = "contains no GeoPackage" if not candidates else "has ambiguous GeoPackage members"
        raise RuntimeError(f"{archive} {reason}: {candidates}; all archive members: {members}")
    return candidates[0], members


def extract_archive_member(archive: Path, output: Path, member: str) -> Path:
    """Extract one validated nested member without flattening its archive path."""
    member_path = Path(member)
    if member_path.is_absolute() or ".." in member_path.parts:
        raise RuntimeError(f"unsafe archive member path {member!r}")
    target = output / member_path
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        with zipfile.ZipFile(archive) as source, source.open(member) as incoming, temporary.open("wb") as outgoing:
            shutil.copyfileobj(incoming, outgoing)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return target


def prepare_source(config: dict, refresh: bool, override: Path | None = None, opener=urllib.request.urlopen,
                   gpkg_inspector=inspect_geopackage) -> tuple[Path, str | None, dict]:
    """Download/cache and deterministically prepare one configured dataset."""
    raw = Path(override) if override else Path(config["rawPath"])
    container_format = config["format"]
    payload_format = config.get("payloadFormat", container_format)
    if override:
        container_format = {".json": "geojson", ".geojson": "geojson", ".gpkg": "geopackage", ".zip": "zip"}.get(raw.suffix.lower(), container_format)
        payload_format = config.get("payloadFormat", container_format) if container_format == "zip" else container_format
    validated_layers = []
    if override:
        validated_layers = validate_source(raw, container_format, gpkg_inspector=gpkg_inspector)
        response = {}
    else:
        response = download(config, refresh, opener, gpkg_inspector)
        validated_layers = response.get("sourceLayers", [])
    archive_member = None; archive_members = []
    if container_format == "zip":
        archive_member, archive_members = select_archive_member(raw, config.get("archiveMember"))
        extracted_root = Path(config.get("extractedDirectory", raw.parent / "extracted" / raw.stem))
        source = extract_archive_member(raw, extracted_root, archive_member)
        validated_layers = validate_source(source, payload_format, gpkg_inspector=gpkg_inspector)
    else:
        source = raw
    layers = validated_layers if payload_format == "geopackage" else []
    layer = config.get("layer")
    if payload_format == "geopackage" and layer and layer not in layers:
        raise RuntimeError(f"{config['datasetName']} configured layer {layer!r} is not available; layers: {layers}")
    if payload_format == "geopackage" and not layer:
        if len(layers) != 1:
            raise RuntimeError(f"{config['datasetName']} GeoPackage has {layers}; configure the intended layer explicitly")
        layer = layers[0]
    return source, layer, {"rawPath": str(raw), "sourceContainerFormat": container_format,
                           "payloadFormat": payload_format, "archiveMember": archive_member,
                           "archiveMembers": archive_members, "extractedPath": str(source) if container_format == "zip" else None,
                           "availableLayers": layers, "selectedLayer": layer,
                           "finalResponseUrl": response.get("finalResponseUrl"),
                           "responseStatus": response.get("responseStatus"), "responseContentType": response.get("responseContentType")}


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
        return {"datasetName": config["datasetName"], "version": config.get("version"), "provider": metadata["provider"], "landingPage": config["landingPage"],
                "configuredDownloadUrl": config["downloadUrl"], "downloadUrl": config["downloadUrl"], "sourceUrl": config["downloadUrl"], "sourcePath": str(source),
                "finalResponseUrl": details.get("finalResponseUrl"), "responseStatus": details.get("responseStatus"),
                "responseContentType": details.get("responseContentType"),
                "rawPath": details.get("rawPath", str(source)), "rawArchivePath": details.get("rawPath") if details.get("sourceContainerFormat") == "zip" else None,
                "sourceFormat": details.get("payloadFormat", info["sourceFormat"]), "sourceContainerFormat": details.get("sourceContainerFormat", info["sourceFormat"]),
                "payloadFormat": details.get("payloadFormat"), "archiveMember": details.get("archiveMember"),
                "archiveMembers": details.get("archiveMembers", []), "extractedPath": details.get("extractedPath"),
                "availableLayers": details.get("availableLayers", info["sourceLayers"]), "selectedLayer": details.get("selectedLayer"),
                "sourceLayers": info["sourceLayers"], "sourceCrs": crs,
                "normalizedCrs": metadata["normalizedCrs"], "license": config["license"], "licenseUrl": config["licenseUrl"],
                "attribution": config["attribution"], "acquiredAt": acquired_at}
    road_manifest = {**provenance(metadata["roads"], roads_source, roads_crs, road_info, source_details[0]), "featureCount": len(roads), "routeIdsPresent": sorted(road_groups), "routeStatistics": {rid: {"featureCount": len(fs), "lengthKm": round(sum(line_length_km(f["geometry"]) for f in fs), 3)} for rid, fs in sorted(road_groups.items())}, "outputs": {"roads": str(road_path), "index": str(roads_output / "index.json")}}
    post_manifest = {**provenance(metadata["posts"], posts_source, posts_crs, post_info, source_details[1]), "featureCount": len(posts), "routeIdsPresent": sorted(post_counts), "countsByRouteId": dict(sorted(post_counts.items())), "outputs": {"posts": str(post_path), "index": str(posts_output / "index.json")}}
    road_index = [{"id": rid, "displayName": next((f["properties"].get("name") for f in fs if f["properties"].get("name")), rid),
                   "altName": next((f["properties"].get("altName") for f in fs if f["properties"].get("altName")), None),
                   "start": next((f["properties"].get("start") for f in fs if f["properties"].get("start")), None),
                   "end": next((f["properties"].get("end") for f in fs if f["properties"].get("end")), None),
                   "entityType": "historical-road", "featureCount": len(fs)} for rid, fs in sorted(road_groups.items())]
    post_index = [{key: post["properties"].get(key) for key in ("postId", "routeId", "name", "historicalLabel", "historicalPlaceId")}
                  for post in posts]
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
