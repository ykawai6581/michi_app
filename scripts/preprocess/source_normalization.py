"""Small, source-agnostic helpers for normalized geospatial caches."""

from __future__ import annotations

import json
import math
from pathlib import Path


def load_features(path: Path) -> tuple[list[dict], str]:
    """Read GeoJSON; other GIS formats use GeoPandas when installed."""
    if path.suffix.lower() in {".json", ".geojson"}:
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("type") == "FeatureCollection":
            return document.get("features", []), document.get("crs", {}).get("properties", {}).get("name", "EPSG:4326")
        if "elements" in document:
            return overpass_features(document), "EPSG:4326"
        raise ValueError(f"{path} is neither GeoJSON nor Overpass JSON")
    try:
        import geopandas as gpd
    except ImportError as error:
        raise RuntimeError("GeoPandas is required to read PBF/GPKG/Shapefile input") from error
    frame = gpd.read_file(path)
    return json.loads(frame.to_json())["features"], frame.crs.to_string() if frame.crs else "unknown"


def overpass_features(document: dict) -> list[dict]:
    """Convert ordinary Overpass geometry-bearing elements to GeoJSON features."""
    features = []
    for element in document.get("elements", []):
        geometry = None
        if element.get("type") == "node" and "lon" in element:
            geometry = {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
        elif element.get("geometry"):
            coordinates = [[item["lon"], item["lat"]] for item in element["geometry"]]
            closed = len(coordinates) > 3 and coordinates[0] == coordinates[-1]
            geometry = {"type": "Polygon", "coordinates": [coordinates]} if closed else {"type": "LineString", "coordinates": coordinates}
        elif element.get("type") == "relation" and element.get("members"):
            lines = [[[point["lon"], point["lat"]] for point in member.get("geometry", [])]
                     for member in element["members"] if member.get("geometry")]
            if lines: geometry = {"type": "MultiLineString", "coordinates": lines}
        if geometry:
            properties = dict(element.get("tags", {}))
            properties.update(osm_element_type=element.get("type"), osm_element_id=element.get("id"))
            features.append({"type": "Feature", "id": f"{element.get('type')}/{element.get('id')}", "properties": properties, "geometry": geometry})
    return features


def normalize_wgs84(features: list[dict], source_crs: str) -> list[dict]:
    """Normalize to WGS84 without changing coordinates already in WGS84."""
    normalized = json.loads(json.dumps(features))
    crs = (source_crs or "").upper()
    if "4326" in crs or "CRS84" in crs:
        return normalized
    if "3857" not in crs:
        raise ValueError(f"unsupported source CRS {source_crs!r}; install GeoPandas and reproject before ingestion")
    def convert(value):
        if isinstance(value[0], (int, float)):
            lon = value[0] * 180 / 20037508.34
            lat = math.degrees(2 * math.atan(math.exp(value[1] / 6378137.0)) - math.pi / 2)
            return [lon, lat, *value[2:]]
        return [convert(item) for item in value]
    for feature in normalized:
        feature["geometry"]["coordinates"] = convert(feature["geometry"]["coordinates"])
    return normalized


def write_dataset(features: list[dict], output: Path) -> None:
    """Write GeoParquet (default) or GeoJSON (fixtures/debugging)."""
    output.parent.mkdir(parents=True, exist_ok=True)
    collection = {"type": "FeatureCollection", "features": features}
    if output.suffix.lower() in {".json", ".geojson"}:
        output.write_text(json.dumps(collection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    try:
        import geopandas as gpd
    except ImportError as error:
        raise RuntimeError("GeoPandas and PyArrow are required to write GeoParquet") from error
    frame = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    frame.to_parquet(output, index=False)


def bounds(features: list[dict]) -> list[float] | None:
    points = []
    def visit(value):
        if value and isinstance(value[0], (int, float)):
            points.append(value[:2])
        else:
            for item in value: visit(item)
    for feature in features: visit(feature["geometry"]["coordinates"])
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)] if points else None


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
