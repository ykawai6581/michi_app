"""Normalize reusable Tokyo OSM railway tracks and passenger stations."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

from source_normalization import bounds, load_features, write_dataset, write_json

FIELDS = ("railway", "name", "name:ja", "name:en", "operator", "network", "ref", "service", "usage", "layer", "bridge", "tunnel", "station", "public_transport", "uic_ref", "wikidata", "wikipedia", "from", "to", "route")


def representative_point(geometry: dict) -> list[float]:
    if geometry["type"] == "Point": return geometry["coordinates"][:2]
    if geometry["type"] not in {"Polygon", "MultiPolygon"}:
        points = []
        def collect(value):
            if value and isinstance(value[0], (int, float)): points.append(value)
            else:
                for item in value: collect(item)
        collect(geometry["coordinates"])
        return [sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)]
    rings = geometry["coordinates"] if geometry["type"] == "Polygon" else geometry["coordinates"][0]
    ring = rings[0]
    # Area centroid is defensible for normal station polygons; mean fallback handles degenerate rings.
    area = cx = cy = 0.0
    for a, b in zip(ring, ring[1:] + ring[:1]):
        cross = a[0] * b[1] - b[0] * a[1]; area += cross
        cx += (a[0] + b[0]) * cross; cy += (a[1] + b[1]) * cross
    return [cx / (3 * area), cy / (3 * area)] if area else [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]


def osm_properties(feature: dict) -> dict:
    raw = feature.get("properties", {})
    result = {key: raw[key] for key in FIELDS if raw.get(key) not in (None, "")}
    element_type = raw.get("osm_element_type") or raw.get("type") or (str(feature.get("id", "")).split("/")[0] or None)
    element_id = raw.get("osm_element_id") or raw.get("id") or (str(feature.get("id", "")).split("/")[-1] or None)
    result.update(osm_element_type=element_type, osm_element_id=element_id,
                  osm_way_id=element_id if element_type == "way" else None)
    return {key: value for key, value in result.items() if value is not None}


def normalize(features: list[dict], policy: dict) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    track_values = set(policy["includedRailwayValues"])
    station_values = set(policy["stationRailwayValues"])
    tracks, candidates = [], []
    for feature in features:
        railway = feature.get("properties", {}).get("railway")
        geometry_type = (feature.get("geometry") or {}).get("type")
        if railway in track_values and geometry_type in {"LineString", "MultiLineString"}:
            tracks.append({"type": "Feature", "properties": {**osm_properties(feature), "sourceType": "openstreetmap", "entityType": "modern-rail-track", "geometryType": geometry_type}, "geometry": feature["geometry"]})
        if railway in station_values and geometry_type in {"Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
            properties = osm_properties(feature); properties.update(sourceType="openstreetmap", entityType="modern-rail-station", geometryType="Point", sourceGeometryType=geometry_type)
            candidates.append({"type": "Feature", "properties": properties, "geometry": {"type": "Point", "coordinates": representative_point(feature["geometry"])}})
    # Authority IDs may describe a station complex with distinct facilities, so only
    # repeated copies of the exact OSM element are removed. Names never merge stations.
    stations, seen = [], set()
    for station in candidates:
        properties = station["properties"]
        key = (properties.get("osm_element_type"), properties.get("osm_element_id"))
        if key in seen: continue
        seen.add(key); stations.append(station)
    ways = {str(item["properties"].get("osm_element_id")): item for item in tracks}
    routes, memberships = [], []
    for feature in features:
        raw = feature.get("properties", {})
        if raw.get("osm_element_type") != "relation" or raw.get("type") not in (None, "route") or raw.get("route") != "railway":
            continue
        relation_id = str(raw.get("osm_element_id"))
        members = raw.get("osm_members") or raw.get("members") or []
        lines = []
        for order, member in enumerate(members):
            if member.get("type") != "way": continue
            way_id = str(member.get("ref") or member.get("id"))
            way = ways.get(way_id)
            if not way: continue
            geometry = way["geometry"]
            lines.extend(geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]])
            memberships.append({"type":"Feature", "properties":{"railRouteId":f"osm-railway-relation:{relation_id}", "osm_relation_id":relation_id, "osm_way_id":way_id, "memberOrder":order, "memberRole":member.get("role") or ""}, "geometry":geometry})
        # GeoJSON/PBF relation fixtures can supply an already assembled geometry.
        if not lines and feature.get("geometry"):
            geometry = feature["geometry"]
            lines.extend(geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]])
        if not lines: continue
        properties = osm_properties(feature)
        properties.update(railRouteId=f"osm-railway-relation:{relation_id}", identitySource="route-relation", sourceType="openstreetmap", entityType="modern-railway-route", geometryType="MultiLineString")
        routes.append({"type":"Feature", "properties":properties, "geometry":{"type":"MultiLineString", "coordinates":lines}})
    return tracks, stations, routes, memberships


def overpass_query(box: list[float], policy: dict) -> str:
    south, west, north, east = box[1], box[0], box[3], box[2]
    tracks = "|".join(map(re.escape, policy["includedRailwayValues"]))
    stations = "|".join(map(re.escape, policy["stationRailwayValues"]))
    return f'[out:json][timeout:300];(way["railway"~"^({tracks})$"]({south},{west},{north},{east});nwr["railway"~"^({stations})$"]({south},{west},{north},{east});rel["type"="route"]["route"="railway"]({south},{west},{north},{east}););out body geom;'


def full_route_query(relation_ids: list[int]) -> str:
    ids = ",".join(map(str, relation_ids))
    return f"[out:json][timeout:600];rel(id:{ids});out body;way(r);out body geom;"


def run(source: Path, output: Path, policy: dict, method="local", source_date=None, configured_bounds=None, extension=".parquet") -> dict:
    features, _, source_info = load_features(source); tracks, stations, routes, memberships = normalize(features, policy)
    track_path, station_path, route_path, member_path = (output / f"tracks{extension}", output / f"stations{extension}", output / f"routes{extension}", output / f"route-members{extension}")
    write_dataset(tracks, track_path); write_dataset(stations, station_path); write_dataset(routes, route_path); write_dataset(memberships, member_path)
    categories = dict(sorted(Counter(f["properties"]["railway"] for f in tracks).items()))
    manifest = {"datasetName": "Tokyo OpenStreetMap rail", "sourceType": "openstreetmap", "acquisitionMethod": method,
                "acquiredAt": datetime.now(timezone.utc).isoformat(), "sourceDate": source_date,
                "discoveryBoundsWgs84": configured_bounds or bounds(tracks + stations), "fullRouteGeometryBoundsWgs84": bounds(routes), "crs": "EPSG:4326",
                "physicalTrackCount":len(tracks), "stationCount":len(stations), "railwayRouteRelationCount":len(routes), "routeMembershipCount":len(memberships),
                "featureCounts": {"tracks": len(tracks), "stations": len(stations), "routes":len(routes), "routeMembers":len(memberships)}, "trackCountsByRailway": categories,
                "sourceFormat": source_info["sourceFormat"], "sourceLayersRead": source_info["sourceLayers"],
                "selection": {"includedTrackRailwayValues": list(policy["includedRailwayValues"]), "includedStationRailwayValues": list(policy["stationRailwayValues"]), "policy": "Selection is based on configured railway values. Included infrastructure is retained regardless of service/usage; yard, siding and spur tracks are not removed. Unconfigured values such as proposed, construction, abandoned and disused are excluded."},
                "model":"Physical tracks are OSM source ways; logical railway identities are OSM type=route + route=railway relations. Complete relation member geometry may extend beyond discovery bounds.",
                "outputs": {"tracks": str(track_path), "stations": str(station_path), "routes":str(route_path), "routeMembers":str(member_path), "index": str(output / "index.json")},
                "provenance": {"provider": "OpenStreetMap contributors", "source": str(source), "license": "ODbL 1.0", "url": "https://www.openstreetmap.org/copyright"}}
    index = [{"railRouteId":r["properties"]["railRouteId"], "name":r["properties"].get("name:ja") or r["properties"].get("name") or r["properties"].get("ref")} for r in routes]
    write_json(output / "manifest.json", manifest); write_json(output / "index.json", index)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input", type=Path)
    parser.add_argument("--config", type=Path, default=Path("data/roads/sources.json")); parser.add_argument("--refresh-osm", action="store_true")
    args = parser.parse_args(); config = json.loads(args.config.read_text())["osm"]; rail = config["rail"]
    source = args.input or Path(config["local"]["path"]); method = "local-regional-pbf"
    if not source.exists() or args.refresh_osm:
        raw = Path("data/raw/osm/tokyo-rail-overpass.json"); raw.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(config["overpass"]["endpoint"], data=urllib.parse.urlencode({"data": overpass_query(rail["bounds"], rail)}).encode(), headers={"User-Agent": "michi-app-source-preprocessor/1.0"})
        discovery = json.loads(urllib.request.urlopen(request, timeout=360).read())
        relation_ids = [e["id"] for e in discovery.get("elements", []) if e.get("type") == "relation" and e.get("tags", {}).get("route") == "railway"]
        if relation_ids:
            request = urllib.request.Request(config["overpass"]["endpoint"], data=urllib.parse.urlencode({"data": full_route_query(relation_ids)}).encode(), headers={"User-Agent": "michi-app-source-preprocessor/1.0"})
            complete = json.loads(urllib.request.urlopen(request, timeout=660).read())
            keyed = {(e["type"], e["id"]):e for e in discovery.get("elements", [])}
            keyed.update({(e["type"], e["id"]):e for e in complete.get("elements", [])})
            discovery["elements"] = list(keyed.values())
        raw.write_text(json.dumps(discovery)); source, method = raw, "overpass-two-stage"
    print(json.dumps(run(source, Path(rail["cacheDirectory"]), rail, method, configured_bounds=rail["bounds"]), ensure_ascii=False, indent=2))
