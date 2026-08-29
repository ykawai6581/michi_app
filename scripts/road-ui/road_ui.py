"""Application services for the local-only Road Builder."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[2]
PREPROCESS = ROOT / "scripts/preprocess"
sys.path.insert(0, str(PREPROCESS))
from road_registry import (N13_CLASS_LABELS, SUPPORTED_N13_CLASSES, get_road,  # noqa: E402
                           list_roads, save_road, validate_road)


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
    _, _, osm, reference, provenance, diagnostics = _context(draft, sources)
    fields = ["name", "name:ja", "name:en", "alt_name", "ref", "highway"]
    values = {field: sorted(set(osm[field].dropna().astype(str))) if field in osm else [] for field in fields}
    ids = sorted(set(osm["osm_way_id"].dropna().astype(str))) if "osm_way_id" in osm else []
    return {"reference": _geojson(reference), "summary": {"wayCount": len(osm), "values": values,
            "wayIds": ids, "provenance": provenance, **diagnostics},
            "discoveredNames": sorted(set(sum((values[field] for field in fields[:4]), [])))}


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


def preview_match(draft: dict, sources: Path = SOURCES) -> dict:
    road, n13, _, reference, provenance, reference_diagnostics = _context(draft, sources)
    candidates = MATCHER.load_n13_candidates(road, n13, reference)
    stage1, measured = MATCHER.match_n13(candidates, reference, road)
    selected, diagnostics, report = MATCHER.select_reference_network(
        stage1, reference, {**road.get("networkSelection", {}),
                            "endpointSnapMeters": road.get("display", {}).get(
                                "endpointSnapMeters", MATCHER.DEFAULT_ENDPOINT_SNAP_METERS)})
    return {"reference": _geojson(reference), "candidates": _geojson(measured),
            "residualPass": _geojson(stage1), "selected": _geojson(selected),
            "diagnostics": _geojson(diagnostics), "report": {"networkSelection": report,
            "osmReference": {**provenance, **reference_diagnostics}, "candidateCount": len(measured),
            "residualPassCount": len(stage1), "selectedFeatureCount": len(selected)}}


def build_road(road_id: str, registry: Path = REGISTRY, runner=subprocess.run) -> dict:
    command = [sys.executable, str(PREPROCESS / "build-road.py"), road_id,
               "--registry", str(registry), "--n13", str(ROOT / "data/cache/n13/roads")]
    completed = runner(command, cwd=ROOT, check=True, capture_output=True, text=True)
    report_path = ROOT / f"public/data/roads/{road_id}.report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    return {"stdout": completed.stdout, "report": report, "reportPath": str(report_path.relative_to(ROOT)),
            "outputs": report.get("outputs", {})}
