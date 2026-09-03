"""Normalize supplied historical jurisdiction GeoJSON/TopoJSON into local runtime assets."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from shapely import union_all
from shapely.geometry import mapping, shape

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
    value = next(
        (properties.get(name) for name in names if properties.get(name) not in (None, "")),
        None,
    )
    normalized = str(value).strip() if value is not None else None
    return normalized or None


def _n03_hierarchy(properties: dict[str, Any]) -> tuple[str | None, str | None]:
    """Resolve N03_003/N03_004/N03_005 as a hierarchy.

    Geoshape snapshots do not use one fixed N03 field for the displayed
    municipality across all eras. Examples:

    - historical Tokyo ward:
        N03_003=東京市, N03_004=杉並区
        -> municipality=杉並区, parent=東京市

    - historical district municipality:
        N03_003=西多摩郡, N03_004=古里村
        -> municipality=古里村, parent=西多摩郡

    - modern Tokyo special ward:
        N03_003=足立区, N03_004=None
        -> municipality=足立区, parent=None

    - designated-city ward:
        N03_004=横浜市, N03_005=鶴見区
        -> municipality=鶴見区, parent=横浜市
    """
    n03_003 = _first(properties, ("N03_003",))
    n03_004 = _first(properties, ("N03_004",))
    n03_005 = _first(properties, ("N03_005",))

    if n03_005:
        return n03_005, n03_004 or n03_003
    if n03_004:
        return n03_004, n03_003
    if n03_003:
        return n03_003, None
    return None, None


def _decode_arcs(document: dict[str, Any]) -> list[list[list[float]]]:
    transform = document.get("transform") or {}
    scale, translate = transform.get("scale"), transform.get("translate")
    if not (
        isinstance(scale, list)
        and len(scale) == 2
        and isinstance(translate, list)
        and len(translate) == 2
    ):
        raise ValueError(
            "Topology transform must contain two-value scale and translate arrays"
        )
    if not isinstance(document.get("arcs"), list):
        raise ValueError("Topology must contain an arcs array")

    decoded = []
    for arc_index, arc in enumerate(document["arcs"]):
        if not isinstance(arc, list):
            raise ValueError(f"Topology arc {arc_index} must be an array")
        x = y = 0
        points = []
        for delta in arc:
            if not isinstance(delta, list) or len(delta) < 2:
                raise ValueError(
                    f"Topology arc {arc_index} contains an invalid delta coordinate"
                )
            x += delta[0]
            y += delta[1]
            points.append(
                [
                    x * scale[0] + translate[0],
                    y * scale[1] + translate[1],
                ]
            )
        decoded.append(points)
    return decoded


def _ring(
    arc_references: Any,
    arcs: list[list[list[float]]],
) -> list[list[float]]:
    if not isinstance(arc_references, list):
        raise ValueError(
            "Topology polygon ring must contain an array of arc references"
        )
    ring: list[list[float]] = []
    for reference in arc_references:
        if not isinstance(reference, int):
            raise ValueError("Topology arc references must be integers")
        index = reference if reference >= 0 else ~reference
        if index >= len(arcs):
            raise ValueError(f"Topology arc reference {reference} is out of range")
        part = arcs[index] if reference >= 0 else list(reversed(arcs[index]))
        ring.extend(part[1:] if ring and part and ring[-1] == part[0] else part)
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0].copy())
    return ring


def _geometry(
    geometry: dict[str, Any],
    arcs: list[list[list[float]]],
) -> dict[str, Any]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("arcs")
    if geometry_type == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [_ring(ring, arcs) for ring in coordinates or []],
        }
    if geometry_type == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [_ring(ring, arcs) for ring in polygon]
                for polygon in coordinates or []
            ],
        }
    raise ValueError(
        f"unsupported Topology geometry type: {geometry_type!r}; "
        "expected Polygon or MultiPolygon"
    )


def topology_to_feature_collection(
    document: dict[str, Any],
    object_name: str | None = None,
) -> dict[str, Any]:
    """Decode the Geoshape TopoJSON subset into a GeoJSON FeatureCollection."""
    if document.get("type") != "Topology":
        raise ValueError("input must be a Topology")
    objects = document.get("objects")
    if not isinstance(objects, dict):
        raise ValueError("Topology must contain an objects mapping")

    if object_name is not None:
        if object_name not in objects:
            raise ValueError(f"Topology object {object_name!r} does not exist")
        selected_name = object_name
    elif "city" in objects:
        selected_name = "city"
    else:
        collections = [
            name
            for name, value in objects.items()
            if value.get("type") == "GeometryCollection"
        ]
        if len(collections) != 1:
            raise ValueError(
                "Topology object is ambiguous; specify an explicit object name"
            )
        selected_name = collections[0]

    selected = objects[selected_name]
    if (
        selected.get("type") != "GeometryCollection"
        or not isinstance(selected.get("geometries"), list)
    ):
        raise ValueError(
            f"Topology object {selected_name!r} must be a GeometryCollection"
        )

    arcs = _decode_arcs(document)
    features = []
    for geometry in selected["geometries"]:
        feature = {
            "type": "Feature",
            "properties": dict(geometry.get("properties") or {}),
            "geometry": _geometry(geometry, arcs),
        }
        if "id" in geometry:
            feature["id"] = geometry["id"]
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def _identity(
    prefecture: str,
    snapshot_date: str,
    properties: dict[str, Any],
    geometry: dict[str, Any],
) -> str:
    stable = {
        "provider": PROVIDER,
        "prefecture": prefecture,
        "snapshotDate": snapshot_date,
        "sourceResourceId": properties.get("sourceResourceId"),
        "administrativeCode": properties.get("administrativeCode"),
        "parentJurisdictionName": properties.get("parentJurisdictionName"),
        "municipalityName": properties["municipalityName"],
        "geometry": geometry,
    }
    digest = hashlib.sha256(
        json.dumps(
            stable,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:20]
    return f"{PROVIDER}:{prefecture}:{snapshot_date}:{digest}"


def normalize_features(
    document: dict[str, Any],
    *,
    prefecture: str,
    snapshot_date: str,
) -> dict[str, Any]:
    if (
        document.get("type") != "FeatureCollection"
        or not isinstance(document.get("features"), list)
    ):
        raise ValueError("input must be a GeoJSON FeatureCollection")

    normalized = []
    for index, feature in enumerate(document["features"]):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError(
                f"feature {index} must have Polygon or MultiPolygon geometry"
            )
        if not geometry.get("coordinates"):
            raise ValueError(f"feature {index} has empty geometry")

        original = feature.get("properties") or {}
        properties = {
            key: _first(original, aliases)
            for key, aliases in ALIASES.items()
        }

        # N03 fields are hierarchical, and their semantic level changes across
        # snapshots. Resolve them together instead of treating N03_003/N03_004
        # as independent aliases.
        if any(
            key in original
            for key in ("N03_003", "N03_004", "N03_005")
        ):
            municipality_name, parent_name = _n03_hierarchy(original)
            if municipality_name:
                properties["municipalityName"] = municipality_name
            properties["parentJurisdictionName"] = parent_name

        for source_name, normalized_name in (
            ("STARTYEAR", "sourceStartYear"),
            ("ENDYEAR", "sourceEndYear"),
        ):
            if original.get(source_name) is not None:
                properties[normalized_name] = original[source_name]

        if not properties["municipalityName"]:
            raise ValueError(f"feature {index} has no municipality name")

        properties.update(
            {
                "snapshotDate": snapshot_date,
                "sourceProvider": "Geoshape",
                "sourceDataset": DATASET,
            }
        )
        properties["jurisdictionId"] = _identity(
            prefecture,
            snapshot_date,
            properties,
            geometry,
        )
        normalized.append(
            {
                "type": "Feature",
                "id": properties["jurisdictionId"],
                "properties": {
                    key: value
                    for key, value in properties.items()
                    if value is not None
                },
                "geometry": geometry,
            }
        )

    normalized.sort(
        key=lambda feature: feature["properties"]["jurisdictionId"]
    )
    return {"type": "FeatureCollection", "features": normalized}


def is_parent_city_merge_eligible(
    features: list[dict[str, Any]],
) -> bool:
    """Return whether a parent group consists entirely of ward-level (区) children.

    A non-empty source parent is necessary but not sufficient: requiring every
    municipality name in the group to end in 区 prevents administrative 郡 groups
    containing villages and towns from being dissolved as parent municipalities.
    """
    return bool(features) and all(
        feature.get("properties", {}).get("parentJurisdictionName")
        and feature.get("properties", {})
        .get("municipalityName", "")
        .endswith("区")
        for feature in features
    )


def parent_city_display(
    collection: dict[str, Any],
    *,
    prefecture: str,
    snapshot_date: str,
) -> dict[str, Any]:
    """Build a complete display collection with eligible ward groups dissolved."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for feature in collection["features"]:
        parent = feature["properties"].get("parentJurisdictionName")
        if parent:
            groups.setdefault(parent, []).append(feature)

    eligible = {
        parent: members
        for parent, members in groups.items()
        if is_parent_city_merge_eligible(members)
    }

    features = [
        feature
        for feature in collection["features"]
        if feature["properties"].get("parentJurisdictionName")
        not in eligible
    ]

    for parent, unsorted_members in eligible.items():
        members = sorted(
            unsorted_members,
            key=lambda feature: feature["properties"]["jurisdictionId"],
        )
        member_ids = [
            feature["properties"]["jurisdictionId"]
            for feature in members
        ]
        source_ids = sorted(
            feature["properties"]["sourceResourceId"]
            for feature in members
            if feature["properties"].get("sourceResourceId")
        )

        identity = {
            "provider": PROVIDER,
            "prefecture": prefecture,
            "snapshotDate": snapshot_date,
            "parentJurisdictionName": parent,
            "memberJurisdictionIds": member_ids,
        }
        digest = hashlib.sha256(
            json.dumps(
                identity,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()[:20]
        jurisdiction_id = (
            f"{PROVIDER}:{prefecture}:{snapshot_date}:parent-city:{digest}"
        )

        dissolved = mapping(
            union_all(
                [shape(feature["geometry"]) for feature in members]
            )
        )
        if dissolved["type"] not in {"Polygon", "MultiPolygon"}:
            raise ValueError(
                f"parent-city dissolve for {parent!r} "
                "did not produce polygon geometry"
            )

        properties = {
            "jurisdictionId": jurisdiction_id,
            "snapshotDate": snapshot_date,
            "prefectureName": members[0]["properties"]["prefectureName"],
            "jurisdictionLevel": "parent",
            "jurisdictionName": parent,
            "municipalityName": parent,
            "memberCount": len(members),
            "memberJurisdictionIds": member_ids,
            "sourceResourceIds": source_ids,
            "sourceProvider": "Geoshape",
            "sourceDataset": DATASET,
            "derived": True,
            "derivation": "dissolved-from-source-jurisdictions",
        }
        features.append(
            {
                "type": "Feature",
                "id": jurisdiction_id,
                "properties": properties,
                "geometry": dissolved,
            }
        )

    features.sort(
        key=lambda feature: feature["properties"]["jurisdictionId"]
    )
    return {"type": "FeatureCollection", "features": features}


def write_snapshot(
    source: Path,
    output_root: Path,
    *,
    prefecture: str,
    prefecture_name: str,
    snapshot_date: str,
    topology_object: str | None = None,
) -> dict[str, Any]:
    document = json.loads(source.read_text(encoding="utf-8"))
    if document.get("type") == "Topology":
        document = topology_to_feature_collection(
            document,
            topology_object,
        )

    collection = normalize_features(
        document,
        prefecture=prefecture,
        snapshot_date=snapshot_date,
    )
    parent_collection = parent_city_display(
        collection,
        prefecture=prefecture,
        snapshot_date=snapshot_date,
    )

    relative = Path(PROVIDER) / prefecture / f"{snapshot_date}.geojson"
    parent_relative = (
        Path(PROVIDER)
        / prefecture
        / f"{snapshot_date}.parents.geojson"
    )

    target = output_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            collection,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )

    (output_root / parent_relative).write_text(
        json.dumps(
            parent_collection,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )

    manifest_path = output_root / "manifest.json"
    manifest = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else {
            "schemaVersion": 1,
            "providers": {
                PROVIDER: {
                    "displayName": "Geoshape",
                    "dataset": DATASET,
                    "datasetName": DATASET_NAME,
                    "sourceUrl": SOURCE_URL,
                    "caution": (
                        "Historical boundaries are beta source-derived "
                        "reconstructions; historical sources may disagree."
                    ),
                    "prefectures": {},
                }
            },
        }
    )

    prefectures = manifest["providers"][PROVIDER]["prefectures"]
    entry = prefectures.setdefault(
        prefecture,
        {
            "displayName": prefecture_name,
            "availableDates": [],
            "snapshots": {},
        },
    )
    entry["displayName"] = prefecture_name
    entry["snapshots"][snapshot_date] = {
        "path": str(relative).replace("\\", "/"),
        "featureCount": len(collection["features"]),
        "parentDisplayPath": str(parent_relative).replace("\\", "/"),
        "parentDisplayFeatureCount": len(parent_collection["features"]),
    }
    entry["snapshots"] = dict(sorted(entry["snapshots"].items()))
    entry["availableDates"] = list(entry["snapshots"])

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return manifest
