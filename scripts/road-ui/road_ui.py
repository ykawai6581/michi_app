"""Application services for the local-only Road Builder."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[2]
PREPROCESS = ROOT / "scripts/preprocess"
sys.path.insert(0, str(PREPROCESS))
from road_registry import (N13_CLASS_LABELS, SUPPORTED_N13_CLASSES, get_road,  # noqa: E402
                           delete_road as delete_registry_road, list_roads, save_road, validate_road)


def _module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, PREPROCESS / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


MATCHER = _module("road_builder_matcher", "match-road.py")
PREPROCESSOR = _module("road_builder_preprocessor", "preprocess-n13.py")
REGISTRY = ROOT / "data/roads/registry.json"
SOURCES = ROOT / "data/roads/sources.json"
PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
PREVIEW_CACHE = ROOT / "data/cache/road-builder/previews"
STALE_PREVIEW_MESSAGE = "Preview is stale; run Preview Match again."


def validate_project_id(project_id: str) -> str:
    if not isinstance(project_id, str) or not PROJECT_ID.fullmatch(project_id):
        raise ValueError("Project ID must match ^[a-z0-9][a-z0-9-]*$")
    return project_id


def list_projects(root: Path = ROOT) -> list[dict]:
    result = []
    for path in sorted((root / "projects").glob("*/project.json")):
        try:
            project = json.loads(path.read_text(encoding="utf-8"))
            project_id = validate_project_id(project.get("id"))
            if path.parent.name == project_id:
                result.append({"id": project_id, "displayName": project.get("displayName", project_id)})
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
    return result


def load_project(project_id: str, root: Path = ROOT) -> dict:
    validate_project_id(project_id)
    return json.loads((root / "projects" / project_id / "project.json").read_text(encoding="utf-8"))


def _validate_project(project: dict, expected_id: str | None = None) -> dict:
    if not isinstance(project, dict):
        raise ValueError("Project must be an object")
    project_id = validate_project_id(project.get("id"))
    if expected_id is not None and project_id != expected_id:
        raise ValueError("Project ID cannot be changed while editing")
    if not isinstance(project.get("displayName"), str) or not project["displayName"].strip():
        raise ValueError("Display name is required")
    layers = project.get("layers")
    if not isinstance(layers, dict):
        raise ValueError("Project layers must be an object")
    # Reuse canonical validation after writing by using its public loader; the
    # structural checks below keep Save independent from materialization.
    if set(layers) - {"modernRoads", "railways", "stations", "historicalRoads", "historicalPosts"}:
        raise ValueError("Project contains an unsupported layer")
    return project


def save_project(project: dict, existing_id: str | None = None, root: Path = ROOT) -> dict:
    project = _validate_project(project, existing_id)
    directory = root / "projects" / project["id"]
    target = directory / "project.json"
    if existing_id is None and target.exists():
        raise RuntimeError(f"Project {project['id']!r} already exists")
    if existing_id is not None and not target.is_file():
        raise FileNotFoundError(f"Project {existing_id!r} does not exist and cannot be updated")
    directory.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".project-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(project, output, ensure_ascii=False, indent=2)
            output.write("\n"); output.flush(); os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return project


def delete_project(project_id: str, root: Path = ROOT) -> dict:
    """Delete one project configuration and only its project-specific built output."""
    validate_project_id(project_id)
    configuration = root / "projects" / project_id
    if not (configuration / "project.json").is_file():
        raise FileNotFoundError(f"Project {project_id!r} does not exist")
    output = root / "public" / "projects" / project_id
    deleted = []
    for path in (configuration, output):
        if path.exists():
            shutil.rmtree(path)
            deleted.append(str(path.relative_to(root)))
    return {"projectId": project_id, "deleted": True, "deletedPaths": deleted}


def project_catalog(root: Path = ROOT) -> dict:
    registry = json.loads((root / "data/roads/registry.json").read_text(encoding="utf-8"))
    roads = [{"id": road["id"], "displayName": road.get("displayName", road["id"]),
              "aliases": road.get("aliases", []),
              "built": (root / "public/data/roads" / f"{road['id']}-n13.geojson").is_file()}
             for road in registry.get("roads", [])]
    codh_index = root / "data/cache/codh/edo-roads/index.json"
    rail_paths = [root / "data/cache/osm/rail" / name for name in ("tracks.parquet", "stations.parquet", "routes.parquet", "route-members.parquet")]
    historical = []
    if codh_index.is_file():
        try:
            historical = [{key: value for key, value in {
                "routeId": item.get("id"), "name": item.get("displayName"),
                "altName": item.get("altName"), "start": item.get("start"),
                "end": item.get("end"), "featureCount": item.get("featureCount")}.items()
                           if value is not None}
                          for item in json.loads(codh_index.read_text(encoding="utf-8"))]
        except (OSError, json.JSONDecodeError, TypeError):
            historical = []
    return {"modernRoads": roads, "historicalRoutes": historical,
            "availability": {
                "codh": {"ready": codh_index.is_file(), "command": "python scripts/preprocess/preprocess-codh.py"},
                "rail": {"ready": all(path.is_file() for path in rail_paths), "command": "python scripts/preprocess/preprocess-rail.py"},
            }}


def build_project(project_id: str, root: Path = ROOT) -> dict:
    validate_project_id(project_id)
    sys.path.insert(0, str(root / "scripts"))
    import project_builder
    manifest = project_builder.materialize_project(root, project_id)
    return {"manifest": manifest, "counts": manifest.get("featureCounts", {})}


def project_preview(project_id: str, root: Path = ROOT) -> dict:
    validate_project_id(project_id)
    output = root / "public/projects" / project_id
    manifest_path = output / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Built project preview missing for {project_id!r}; use Save & Build")
    names = {"modernRoads":"modern-roads", "railways":"railways", "stations":"stations",
             "historicalRoads":"historical-roads", "historicalPosts":"historical-posts"}
    return {"manifest": json.loads(manifest_path.read_text(encoding="utf-8")),
            "layers": {family: json.loads((output / "data" / f"{name}.geojson").read_text(encoding="utf-8"))
                       for family, name in names.items()}}


def project_references(road_id: str, root: Path = ROOT) -> list[dict]:
    return [{"id": project["id"], "displayName": project.get("displayName", project["id"])}
            for summary in list_projects(root)
            for project in [load_project(summary["id"], root)]
            if road_id in project.get("layers", {}).get("modernRoads", [])]


def delete_road(road_id: str, registry: Path = REGISTRY, root: Path = ROOT) -> dict:
    # Validation/existence and the atomic registry mutation live in the shared helper.
    get_road(registry, road_id)
    references = project_references(road_id, root)
    report_path = root / "public/data/roads" / f"{road_id}.report.json"
    candidates = [root / "public/data/roads" / f"{road_id}-n13.geojson",
                  root / "public/data/roads" / f"{road_id}-osm.geojson", report_path,
                  root / "data/cache/osm/references" / f"{road_id}-osm.geojson"]
    if report_path.is_file():
        try:
            for value in json.loads(report_path.read_text(encoding="utf-8")).get("outputs", {}).values():
                path = root / value
                if path.resolve().is_relative_to(root.resolve()) and path.name in {
                        f"{road_id}-n13.geojson", f"{road_id}-osm.geojson", f"{road_id}.report.json"}:
                    candidates.append(path)
        except (OSError, TypeError, json.JSONDecodeError):
            pass
    delete_registry_road(registry, road_id)
    deleted = []
    for path in dict.fromkeys(candidates):
        if path.is_file():
            path.unlink(); deleted.append(str(path.relative_to(root)))
    return {"roadId": road_id, "deleted": True, "deletedPaths": deleted,
            "referencedByProjects": references}


def metadata(sources: Path = SOURCES) -> dict:
    config = MATCHER.load_source_config(sources)
    cache = ROOT / config["n13"]["cache"]
    manifest_path = cache / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    available = set(map(str, manifest.get("availableClasses", [])))
    classes = [{"value": value, "label": N13_CLASS_LABELS[value]}
               for value in sorted(SUPPORTED_N13_CLASSES)]
    return {"classes": classes, "availableClasses": sorted(available),
            "missingClasses": sorted(SUPPORTED_N13_CLASSES - available), "manifest": manifest}


def _context(draft: dict, sources: Path = SOURCES):
    road = validate_road(draft)
    config = MATCHER.load_source_config(sources)
    n13 = ROOT / config["n13"]["cache"]
    _, manifest = MATCHER.load_n13_manifest(n13)
    osm, provenance = MATCHER.build_osm_reference(road, config, manifest["boundsWgs84"])
    reference, diagnostics = MATCHER.build_reference(road, osm)
    return road, n13, osm, reference, provenance, diagnostics


def _geojson(frame) -> dict:
    if hasattr(frame, "to_crs"):
        # N13 columns can contain pandas/numpy/date-like scalar values (notably
        # pandas.Timestamp). Preserve those properties, stringifying only
        # values the standard JSON encoder does not understand.
        return json.loads(frame.to_crs("EPSG:4326").to_json(drop_id=True, default=str))
    geometry = gpd.GeoSeries([frame], crs=MATCHER.METRIC_CRS).to_crs("EPSG:4326").iloc[0]
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
                                                           "geometry": mapping(geometry)}]}


def inspect_osm(draft: dict, sources: Path = SOURCES) -> dict:
    road, _, osm, reference, provenance, diagnostics = _context(draft, sources)
    _, excluded = MATCHER.filter_reference_members(road, osm)
    fields = ["name", "name:ja", "name:en", "alt_name", "ref", "highway"]
    values = {field: sorted(set(osm[field].dropna().astype(str))) if field in osm else [] for field in fields}
    ids = sorted(set(osm["osm_way_id"].dropna().astype(str))) if "osm_way_id" in osm else []
    discovered = sorted({token.strip() for field in fields[:4] for value in values[field]
                         for token in value.split(";") if token.strip()})
    return {"reference": _geojson(reference), "referenceExcluded": _geojson(excluded),
            "summary": {"values": values, "wayIds": ids, "provenance": provenance, **diagnostics,
                        "memberWayCount": len(osm), "excludedByExactNameCount": len(excluded),
                        "wayCount": len(osm) - len(excluded)},
            "discoveredNames": discovered}


def analyze_n13(draft: dict, sources: Path = SOURCES) -> dict:
    road, n13, _, reference, _, _ = _context(draft, sources)
    candidates = MATCHER.load_n13_candidates(road, n13, reference)
    residual, measured = MATCHER.match_n13(candidates, reference, road)
    summaries = []
    for road_class in road["n13"]["classifications"]:
        nearby = measured[measured["N13_003"].astype(str) == road_class]
        passed = residual[residual["N13_003"].astype(str) == road_class]
        summaries.append({"class": road_class, "nearbyFeatures": len(nearby),
                          "residualPassFeatures": len(passed),
                          "matchedLengthMeters": round(float(passed.geometry.length.sum()), 1),
                          "medianResidualMeters": None if passed.empty else round(float(passed.match_median_m.median()), 2),
                          "suggested": bool(len(passed))})
    return {"classes": summaries, "candidates": _geojson(measured), "residualPass": _geojson(residual),
            "cache": metadata(sources)}


def prepare_class(road_class: str, sources: Path = SOURCES, runner=PREPROCESSOR.preprocess_n13) -> dict:
    if road_class not in SUPPORTED_N13_CLASSES:
        raise ValueError("Unsupported N13 class")
    config = MATCHER.load_source_config(sources)
    cache = ROOT / config["n13"]["cache"]
    manifest_path = cache / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError("N13 manifest is missing; preprocess the initial cache first")
    manifest = json.loads(manifest_path.read_text())
    source = Path(manifest.get("source", ""))
    if not source.is_absolute():
        source = ROOT / source
    if not source.is_file():
        raise RuntimeError(f"Raw N13 source is unavailable: {source}")
    return runner(source, cache, [road_class])


def draft_hash(draft: dict) -> str:
    """Hash the canonical validated road, preserving meaningful list order."""
    normalized = validate_road(draft)
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _file_hash(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _source_fingerprint(road: dict, config: dict, n13: Path) -> dict:
    osm_cache = Path(config["osm"]["cacheDirectory"]) / f"{road['id']}-osm.geojson"
    return {"schemaVersion": MATCHER.ROAD_BUILD_SCHEMA_VERSION,
            "n13Manifest": _file_hash(n13 / "manifest.json"),
            "osmReference": _file_hash(osm_cache),
            "osmReferenceMetadata": _file_hash(osm_cache.with_suffix(".meta.json"))}


def _cleanup_previews(cache: Path, road_id: str, retain: int = 5) -> None:
    entries = sorted((item for item in cache.glob("*") if item.is_dir()),
                     key=lambda item: item.stat().st_mtime, reverse=True)
    matching = []
    for item in entries:
        try:
            if json.loads((item / "metadata.json").read_text()).get("roadId") == road_id:
                matching.append(item)
        except (OSError, json.JSONDecodeError):
            if time.time() - item.stat().st_mtime > 7 * 86400:
                shutil.rmtree(item, ignore_errors=True)
    for item in matching[retain:]:
        shutil.rmtree(item, ignore_errors=True)


def preview_match(draft: dict, sources: Path = SOURCES, cache: Path = PREVIEW_CACHE) -> dict:
    road = validate_road(draft)
    config = MATCHER.load_source_config(sources)
    n13 = Path(config["n13"]["cache"])
    result = MATCHER.compute_road_build(road, config, n13)
    fingerprint = _source_fingerprint(road, config, n13)
    preview_id = uuid.uuid4().hex
    directory = cache / preview_id
    directory.mkdir(parents=True, exist_ok=False)
    diagnostic_path = Path("data/diagnostics") / f"{road['id']}-selection.geojson"
    artifacts = MATCHER.road_build_artifacts(result, diagnostic_path)
    for name, content in artifacts.items():
        (directory / f"{name}.artifact").write_bytes(content)
    final_n13 = json.loads(artifacts["n13"])
    response = {"previewId": preview_id, "draftHash": draft_hash(road),
        "reference": _geojson(result["reference"]), "referenceExcluded": _geojson(result["referenceExcluded"]),
        "candidates": _geojson(result["candidates"]), "residualPass": _geojson(result["residualPass"]),
        "selected": final_n13, "diagnostics": _geojson(result["selectionDiagnostics"]),
        "ownership": _geojson(result["ownershipSamples"]), "report": json.loads(artifacts["report"])}
    metadata_payload = {"previewId": preview_id, "roadId": road["id"], "draftHash": response["draftHash"],
                        "sourceFingerprint": fingerprint, "createdAt": time.time()}
    (directory / "metadata.json").write_text(json.dumps(metadata_payload, sort_keys=True), encoding="utf-8")
    (directory / "preview.json").write_text(json.dumps(response, ensure_ascii=False, default=str), encoding="utf-8")
    _cleanup_previews(cache, road["id"])
    return response


def build_road(road_id: str, preview_id: str, draft: dict, registry: Path = REGISTRY,
               sources: Path = SOURCES, cache: Path = PREVIEW_CACHE) -> dict:
    """Promote cached bytes; never recompute or fall back to the matcher."""
    road = validate_road(draft)
    directory = cache / str(preview_id)
    try:
        metadata_payload = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        config = MATCHER.load_source_config(sources)
        n13 = Path(config["n13"]["cache"])
        valid = (road["id"] == road_id == metadata_payload["roadId"]
                 and draft_hash(road) == metadata_payload["draftHash"]
                 and _source_fingerprint(road, config, n13) == metadata_payload["sourceFingerprint"]
                 and metadata_payload["sourceFingerprint"]["schemaVersion"] == MATCHER.ROAD_BUILD_SCHEMA_VERSION)
        artifacts = {name: (directory / f"{name}.artifact").read_bytes()
                     for name in ("n13", "osm", "report", "diagnostics")}
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        valid = False
    if not valid:
        raise RuntimeError(STALE_PREVIEW_MESSAGE)
    existing = None
    try:
        get_road(registry, road_id); existing = road_id
    except KeyError:
        pass
    save_road(registry, road, existing)
    # The result frames are unnecessary for promotion because preview serialized
    # the complete canonical artifacts. A minimal carrier supplies publication identity.
    report = json.loads(artifacts["report"])
    targets = {"n13": ROOT / f"public/data/roads/{road_id}-n13.geojson",
               "osm": ROOT / f"public/data/roads/{road_id}-osm.geojson",
               "report": ROOT / f"public/data/roads/{road_id}.report.json",
               "diagnostics": ROOT / f"data/diagnostics/{road_id}-selection.geojson"}
    for name, target in targets.items():
        MATCHER._atomic_write(target, artifacts[name])
    MATCHER.rebuild_search_index(registry)
    return {"report": report, "reportPath": f"public/data/roads/{road_id}.report.json",
            "outputs": report.get("outputs", {}), "previewId": preview_id}
