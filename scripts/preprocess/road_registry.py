"""Shared validation and atomic persistence for the canonical-road registry."""

from __future__ import annotations

import copy
import json
import os
import re
import tempfile
from pathlib import Path

SUPPORTED_N13_CLASSES = {"1", "2", "3", "4", "5", "6"}
N13_CLASS_LABELS = {
    value: f"N13_003 class {value}" for value in SUPPORTED_N13_CLASSES
}
ENTITY_TYPES = {"statutory-road", "named-road"}
NAMED_ROAD_PATTERN = re.compile(r"tokyo-named-[a-z0-9]+(?:-[a-z0-9]+)*")
OSM_NAME_TAGS = ["name", "name:ja", "alt_name"]
MATCHING_DEFAULTS = {
    "sampleIntervalMeters": 5,
    "maximumMedianResidualMeters": 20,
    "maximumP90ResidualMeters": 25,
    "coverageToleranceMeters": 25,
}


def _unique(values) -> list[str]:
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def load_registry(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def list_roads(path: Path) -> list[dict]:
    return load_registry(path).get("roads", [])


def get_road(path: Path, road_id: str) -> dict:
    try:
        return copy.deepcopy(next(road for road in list_roads(path) if road.get("id") == road_id))
    except StopIteration as error:
        raise KeyError(f"Unknown road id {road_id!r}") from error


def validate_road(value: dict) -> dict:
    """Validate and normalize a complete draft without discarding unknown fields."""
    if not isinstance(value, dict):
        raise ValueError("Road must be a JSON object")
    road = copy.deepcopy(value)
    road_id = str(road.get("id", "")).strip()
    entity_type = road.get("entityType")
    if not road_id or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", road_id):
        raise ValueError("id must contain lowercase letters, numbers, and hyphens")
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"entityType must be one of {sorted(ENTITY_TYPES)}")
    if entity_type == "named-road" and not NAMED_ROAD_PATTERN.fullmatch(road_id):
        raise ValueError("Tokyo named-road ids must match tokyo-named-NAME")
    if not str(road.get("displayName", "")).strip():
        raise ValueError("displayName is required")
    road["id"] = road_id
    road["displayName"] = str(road["displayName"]).strip()
    road["jurisdiction"] = str(road.get("jurisdiction", "")).strip()
    road["aliases"] = _unique(road.get("aliases", []))
    n13 = road.setdefault("n13", {})
    classes = _unique(n13.get("classifications", []))
    unsupported = set(classes) - SUPPORTED_N13_CLASSES
    if not classes or unsupported:
        raise ValueError(
            f"n13.classifications must be a non-empty subset of {sorted(SUPPORTED_N13_CLASSES)}"
        )
    n13["classifications"] = classes
    reference = road.setdefault("reference", {})
    expected_reference = "osm-name" if entity_type == "named-road" else "osm-ref"
    if reference.get("type") != expected_reference:
        raise ValueError(f"{entity_type} requires reference.type={expected_reference}")
    if entity_type == "named-road":
        names = _unique(reference.get("names", []))
        tags = _unique(reference.get("tags", OSM_NAME_TAGS))
        if not names:
            raise ValueError("reference.names must contain at least one exact OSM name")
        if not tags:
            raise ValueError("reference.tags must contain at least one OSM name tag")
        reference["names"], reference["tags"] = names, tags
    else:
        reference["ref"] = str(reference.get("ref", "")).strip()
        if not reference["ref"]:
            raise ValueError("statutory-road reference.ref is required")
        if "network" in reference:
            reference["network"] = str(reference["network"]).strip()
        reference["excludeNames"] = _unique(reference.get("excludeNames", []))
        if "excludeNameTags" in reference:
            reference["excludeNameTags"] = _unique(reference["excludeNameTags"])
    road["matching"] = {**MATCHING_DEFAULTS, **road.get("matching", {})}
    priority = _unique(road["matching"].get("n13ClassPriority", []))
    if set(priority) - set(classes):
        raise ValueError("matching.n13ClassPriority must contain only enabled n13.classifications")
    if priority:
        road["matching"]["n13ClassPriority"] = priority
    else:
        road["matching"].pop("n13ClassPriority", None)
    return road


def save_road(path: Path, draft: dict, editing_id: str | None = None) -> dict:
    """Create or replace one road, using an fsync'd atomic rename."""
    road = validate_road(draft)
    registry = load_registry(path)
    roads = registry.setdefault("roads", [])
    matches = [index for index, item in enumerate(roads) if item.get("id") == road["id"]]
    if editing_id is None and matches:
        raise RuntimeError(f"Road {road['id']!r} is already present in {path}")
    if editing_id is not None:
        editing = [index for index, item in enumerate(roads) if item.get("id") == editing_id]
        if not editing:
            raise KeyError(f"Unknown road id {editing_id!r}")
        if road["id"] != editing_id and matches:
            raise RuntimeError(f"Road {road['id']!r} is already present in {path}")
        roads[editing[0]] = road
    else:
        roads.append(road)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
            json.dump(registry, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
            temporary = Path(output.name)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return road


def delete_road(path: Path, road_id: str) -> dict:
    """Atomically remove exactly one registered road and preserve registry metadata."""
    if not isinstance(road_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", road_id):
        raise ValueError("id must contain lowercase letters, numbers, and hyphens")
    registry = load_registry(path)
    roads = registry.get("roads", [])
    matches = [road for road in roads if road.get("id") == road_id]
    if not matches:
        raise KeyError(f"Unknown road id {road_id!r}")
    registry["roads"] = [road for road in roads if road.get("id") != road_id]
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
            json.dump(registry, output, ensure_ascii=False, indent=2); output.write("\n")
            output.flush(); os.fsync(output.fileno()); temporary = Path(output.name)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists(): temporary.unlink()
    return copy.deepcopy(matches[0])
