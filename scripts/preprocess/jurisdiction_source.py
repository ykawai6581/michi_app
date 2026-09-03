"""Normalize supplied historical jurisdiction GeoJSON into local runtime assets."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

PROVIDER = "geoshape"
DATASET = "historical-administrative-areas-beta"
DATASET_NAME = "Geoshape 歴史的行政区域データセットβ版"
SOURCE_URL = "https://geoshape.ex.nii.ac.jp/city/"

ALIASES = {
    "municipalityName": ("municipalityName", "city_name", "cityName", "name", "N03_004"),
    "parentJurisdictionName": ("parentJurisdictionName", "parent_name", "districtName", "N03_003"),
    "prefectureName": ("prefectureName", "pref_name", "prefecture", "N03_001"),
    "administrativeCode": ("administrativeCode", "city_code", "code", "N03_007"),
    "sourceResourceId": ("sourceResourceId", "resource_id", "geoshapeId", "id"),
}


def _first(properties: dict[str, Any], names: tuple[str, ...]) -> str | None:
    value = next((properties.get(name) for name in names if properties.get(name) not in (None, "")), None)
    return str(value).strip() if value is not None else None


def _identity(prefecture: str, snapshot_date: str, properties: dict[str, Any], geometry: dict[str, Any]) -> str:
    stable = {
        "provider": PROVIDER, "prefecture": prefecture, "snapshotDate": snapshot_date,
        "sourceResourceId": properties.get("sourceResourceId"),
        "administrativeCode": properties.get("administrativeCode"),
        "parentJurisdictionName": properties.get("parentJurisdictionName"),
        "municipalityName": properties["municipalityName"], "geometry": geometry,
    }
    digest = hashlib.sha256(json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]
    return f"{PROVIDER}:{prefecture}:{snapshot_date}:{digest}"


def normalize_features(document: dict[str, Any], *, prefecture: str, snapshot_date: str) -> dict[str, Any]:
    if document.get("type") != "FeatureCollection" or not isinstance(document.get("features"), list):
        raise ValueError("input must be a GeoJSON FeatureCollection")
    normalized = []
    for index, feature in enumerate(document["features"]):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"feature {index} must have Polygon or MultiPolygon geometry")
        if not geometry.get("coordinates"):
            raise ValueError(f"feature {index} has empty geometry")
        original = feature.get("properties") or {}
        properties = {key: _first(original, aliases) for key, aliases in ALIASES.items()}
        if not properties["municipalityName"]:
            raise ValueError(f"feature {index} has no municipality name")
        properties.update({"snapshotDate": snapshot_date, "sourceProvider": "Geoshape", "sourceDataset": DATASET})
        properties["jurisdictionId"] = _identity(prefecture, snapshot_date, properties, geometry)
        normalized.append({"type": "Feature", "id": properties["jurisdictionId"], "properties": {k:v for k,v in properties.items() if v is not None}, "geometry": geometry})
    normalized.sort(key=lambda feature: feature["properties"]["jurisdictionId"])
    return {"type": "FeatureCollection", "features": normalized}


def write_snapshot(source: Path, output_root: Path, *, prefecture: str, prefecture_name: str, snapshot_date: str) -> dict[str, Any]:
    document = json.loads(source.read_text(encoding="utf-8"))
    collection = normalize_features(document, prefecture=prefecture, snapshot_date=snapshot_date)
    relative = Path(PROVIDER) / prefecture / f"{snapshot_date}.geojson"
    target = output_root / relative; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(collection, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    manifest_path = output_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {
        "schemaVersion": 1,
        "providers": {PROVIDER: {"displayName": "Geoshape", "dataset": DATASET, "datasetName": DATASET_NAME,
            "sourceUrl": SOURCE_URL, "caution": "Historical boundaries are beta source-derived reconstructions; historical sources may disagree.", "prefectures": {}}}}
    prefectures = manifest["providers"][PROVIDER]["prefectures"]
    entry = prefectures.setdefault(prefecture, {"displayName": prefecture_name, "availableDates": [], "snapshots": {}})
    entry["displayName"] = prefecture_name
    entry["snapshots"][snapshot_date] = {"path": str(relative).replace("\\", "/"), "featureCount": len(collection["features"])}
    entry["snapshots"] = dict(sorted(entry["snapshots"].items()))
    entry["availableDates"] = list(entry["snapshots"])
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest
