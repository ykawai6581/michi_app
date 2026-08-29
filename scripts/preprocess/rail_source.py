"""Normalize reusable Tokyo OSM railway tracks and passenger stations."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.parse
import urllib.request

from source_normalization import bounds, load_features, write_dataset, write_json

TRACK_VALUES = {"rail", "subway", "light_rail", "tram"}
STATION_VALUES = {"station", "halt"}
FIELDS = ("railway", "name", "name:ja", "name:en", "operator", "network", "ref", "service", "usage", "layer", "bridge", "tunnel", "station", "public_transport", "uic_ref", "wikidata")


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


def normalize(features: list[dict]) -> tuple[list[dict], list[dict]]:
    tracks, candidates = [], []
    for feature in features:
        railway = feature.get("properties", {}).get("railway")
        geometry_type = feature.get("geometry", {}).get("type")
        if railway in TRACK_VALUES and geometry_type in {"LineString", "MultiLineString"}:
            tracks.append({"type": "Feature", "properties": {**osm_properties(feature), "sourceType": "openstreetmap", "entityType": "modern-rail-track", "geometryType": geometry_type}, "geometry": feature["geometry"]})
        if railway in STATION_VALUES and geometry_type in {"Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
            properties = osm_properties(feature); properties.update(sourceType="openstreetmap", entityType="modern-rail-station", geometryType="Point", sourceGeometryType=geometry_type)
            candidates.append({"type": "Feature", "properties": properties, "geometry": {"type": "Point", "coordinates": representative_point(feature["geometry"])}})
    # Exact OSM identity and exact authority IDs are safe duplicate signals. Names never merge stations.
    stations, seen = [], set()
    for station in candidates:
        properties = station["properties"]
        authority = ("uic_ref", properties["uic_ref"]) if properties.get("uic_ref") else (("wikidata", properties["wikidata"]) if properties.get("wikidata") else None)
        key = authority or (properties.get("osm_element_type"), properties.get("osm_element_id"))
        if key in seen: continue
        seen.add(key); stations.append(station)
    return tracks, stations


def overpass_query(box: list[float]) -> str:
    south, west, north, east = box[1], box[0], box[3], box[2]
    return f'[out:json][timeout:300];(way["railway"~"^(rail|subway|light_rail|tram)$"]({south},{west},{north},{east});nwr["railway"~"^(station|halt)$"]({south},{west},{north},{east}););out body geom;'


def run(source: Path, output: Path, method="local", source_date=None, configured_bounds=None, extension=".parquet") -> dict:
    features, _ = load_features(source); tracks, stations = normalize(features)
    track_path, station_path = output / f"tracks{extension}", output / f"stations{extension}"
    write_dataset(tracks, track_path); write_dataset(stations, station_path)
    categories = dict(sorted(Counter(f["properties"]["railway"] for f in tracks).items()))
    manifest = {"datasetName": "Tokyo OpenStreetMap rail", "sourceType": "openstreetmap", "acquisitionMethod": method,
                "acquiredAt": datetime.now(timezone.utc).isoformat(), "sourceDate": source_date,
                "workingBoundsWgs84": configured_bounds or bounds(features), "crs": "EPSG:4326",
                "featureCounts": {"tracks": len(tracks), "stations": len(stations)}, "trackCountsByRailway": categories,
                "selection": {"includedTrackRailwayValues": sorted(TRACK_VALUES), "includedStationRailwayValues": sorted(STATION_VALUES), "excludedPolicy": "All other railway values, including proposed, construction, disused, abandoned and narrow industrial service-only categories, are excluded."},
                "outputs": {"tracks": str(track_path), "stations": str(station_path), "index": str(output / "index.json")},
                "provenance": {"provider": "OpenStreetMap contributors", "source": str(source), "license": "ODbL 1.0", "url": "https://www.openstreetmap.org/copyright"}}
    index = sorted({(f["properties"].get("name") or f["properties"].get("name:ja") or "", f["properties"].get("network", ""), f["properties"].get("operator", "")) for f in tracks + stations})
    write_json(output / "manifest.json", manifest); write_json(output / "index.json", [{"name": a, "network": b or None, "operator": c or None} for a,b,c in index if a])
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input", type=Path)
    parser.add_argument("--config", type=Path, default=Path("data/roads/sources.json")); parser.add_argument("--refresh-osm", action="store_true")
    args = parser.parse_args(); config = json.loads(args.config.read_text())["osm"]; rail = config["rail"]
    source = args.input or Path(config["local"]["path"]); method = "local-regional-pbf"
    if not source.exists() or args.refresh_osm:
        raw = Path("data/raw/osm/tokyo-rail-overpass.json"); raw.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(config["overpass"]["endpoint"], data=urllib.parse.urlencode({"data": overpass_query(rail["bounds"])}).encode(), headers={"User-Agent": "michi-app-source-preprocessor/1.0"})
        raw.write_bytes(urllib.request.urlopen(request, timeout=360).read()); source, method = raw, "overpass"
    print(json.dumps(run(source, Path(rail["cacheDirectory"]), method, configured_bounds=rail["bounds"]), ensure_ascii=False, indent=2))
