"""Small, source-agnostic helpers for normalized geospatial caches."""

from __future__ import annotations

import json
import math
from pathlib import Path
import re

OSM_PBF_LAYERS = ("points", "lines", "multilinestrings", "multipolygons", "other_relations")
_OTHER_TAG = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def _frame_features(frame, layer: str | None = None) -> list[dict]:
    features = json.loads(frame.to_json())["features"]
    if not layer:
        return features
    for feature in features:
        properties = feature.setdefault("properties", {})
        for key, value in _OTHER_TAG.findall(properties.pop("other_tags", "") or ""):
            properties.setdefault(key.replace(r'\"', '"'), value.replace(r'\"', '"'))
        osm_id = properties.get("osm_id")
        element_type = "node" if layer == "points" else ("relation" if layer in {"multilinestrings", "other_relations"} else "way")
        properties.setdefault("osm_element_type", element_type)
        properties.setdefault("osm_element_id", osm_id)
        feature["id"] = feature.get("id") or f"{element_type}/{osm_id}"
    return features


def pbf_layer_names(path: Path, pyogrio_module=None) -> list[str]:
    """Return relevant layers actually exposed by GDAL's OSM driver."""
    if pyogrio_module is None:
        try:
            import pyogrio as pyogrio_module
        except ImportError as error:
            raise RuntimeError("Pyogrio is required to inspect OSM PBF layers") from error
    available = {str(row[0]) for row in pyogrio_module.list_layers(path)}
    return [layer for layer in OSM_PBF_LAYERS if layer in available]


def load_osm_pbf(path: Path, pyogrio_module=None) -> tuple[list[dict], str, list[str]]:
    """Read every relevant OSM layer, filtering railway tags at the driver when possible."""
    if pyogrio_module is None:
        try:
            import pyogrio as pyogrio_module
        except ImportError as error:
            raise RuntimeError("Pyogrio is required to read OSM PBF input") from error
    layers = pbf_layer_names(path, pyogrio_module)
    if not layers:
        raise RuntimeError(f"{path} exposes none of the expected OSM layers {OSM_PBF_LAYERS}")
    features, crs = [], None
    for layer in layers:
        # railway may be promoted by osmconf.ini; otherwise it is stored in other_tags.
        where = '"railway" IS NOT NULL OR "other_tags" LIKE \'%"railway"%\''
        try:
            frame = pyogrio_module.read_dataframe(path, layer=layer, where=where)
        except Exception:
            # Driver/schema variants can reject the expression. Reading that layer is
            # slower but maintains correctness; normalization still filters precisely.
            frame = pyogrio_module.read_dataframe(path, layer=layer)
        crs = crs or getattr(frame, "crs", None)
        features.extend(_frame_features(frame, layer))
    return features, crs.to_string() if crs else "EPSG:4326", layers


def load_features(path: Path, layer: str | None = None) -> tuple[list[dict], str, dict]:
    """Read GeoJSON, an explicit GIS layer, or all relevant OSM PBF layers."""
    path = Path(path)
    if path.name.lower().endswith(".osm.pbf") or path.suffix.lower() == ".pbf":
        features, crs, layers = load_osm_pbf(path)
        return features, crs, {"sourceFormat": "OSM PBF", "sourceLayers": layers}
    if path.suffix.lower() in {".json", ".geojson"}:
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("type") == "FeatureCollection":
            crs = document.get("crs", {}).get("properties", {}).get("name", "EPSG:4326")
            return document.get("features", []), crs, {"sourceFormat": "GeoJSON", "sourceLayers": []}
        if "elements" in document:
            return overpass_features(document), "EPSG:4326", {"sourceFormat": "Overpass JSON", "sourceLayers": []}
        raise ValueError(f"{path} is neither GeoJSON nor Overpass JSON")
    try:
        import geopandas as gpd
    except ImportError as error:
        raise RuntimeError("GeoPandas is required to read GPKG/Shapefile input") from error
    frame = gpd.read_file(path, layer=layer)
    source_crs = frame.crs.to_string() if frame.crs else "unknown"
    exchange_frame = frame.to_crs("EPSG:4326") if frame.crs and "4326" not in source_crs.upper() else frame
    return _frame_features(exchange_frame), source_crs, {
        "sourceFormat": path.suffix.lstrip(".").upper() or "GIS dataset",
        "sourceLayers": [layer] if layer else [],
    }


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
            if lines:
                geometry = {"type": "MultiLineString", "coordinates": lines}
        if element.get("type") == "relation":
            properties = dict(element.get("tags", {}))
            properties.update(osm_element_type="relation", osm_element_id=element.get("id"), osm_members=element.get("members", []))
            features.append({"type": "Feature", "id": f"relation/{element.get('id')}", "properties": properties, "geometry": geometry})
        elif geometry:
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
        raise ValueError(f"unsupported source CRS {source_crs!r}; reproject the source to EPSG:4326")

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
    gpd.GeoDataFrame.from_features(features, crs="EPSG:4326").to_parquet(output, index=False)


def bounds(features: list[dict]) -> list[float] | None:
    points = []
    def visit(value):
        if value and isinstance(value[0], (int, float)):
            points.append(value[:2])
        else:
            for item in value:
                visit(item)
    for feature in features:
        visit(feature["geometry"]["coordinates"])
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)] if points else None


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
