"""Local-only Road Builder service tests."""

from __future__ import annotations

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString

import road_ui


ROAD = {
    "id": "tokyo-named-test-dori", "displayName": "テスト通り", "entityType": "named-road",
    "jurisdiction": "Tokyo", "aliases": ["テスト通り", "テスト通り"],
    "reference": {"type": "osm-name", "names": ["テスト通り", "テスト通り"], "tags": ["name"]},
    "n13": {"classifications": ["2"]},
    "matching": {"sampleIntervalMeters": 5, "maximumMedianResidualMeters": 20,
                 "maximumP90ResidualMeters": 25, "coverageToleranceMeters": 25},
}


class RoadBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.registry = Path(self.temp.name) / "registry.json"
        self.registry.write_text(json.dumps({"display": {}, "roads": [ROAD]}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_list_and_load(self):
        self.assertEqual(road_ui.list_roads(self.registry)[0]["id"], ROAD["id"])
        self.assertEqual(road_ui.get_road(self.registry, ROAD["id"])["displayName"], "テスト通り")

    def test_validate_named_draft_deduplicates(self):
        result = road_ui.validate_road(ROAD)
        self.assertEqual(result["aliases"], ["テスト通り"])
        self.assertEqual(result["reference"]["names"], ["テスト通り"])

    def test_atomic_create_edit_and_duplicate(self):
        new = copy.deepcopy(ROAD)
        new["id"] = "tokyo-named-another-dori"
        road_ui.save_road(self.registry, new)
        with self.assertRaises(RuntimeError):
            road_ui.save_road(self.registry, new)
        new["displayName"] = "変更"
        road_ui.save_road(self.registry, new, new["id"])
        self.assertEqual(road_ui.get_road(self.registry, new["id"])["displayName"], "変更")
        self.assertFalse(list(self.registry.parent.glob("tmp*")))

    @patch.object(road_ui, "_context")
    def test_osm_inspection_uses_local_frame(self, context):
        osm = gpd.GeoDataFrame({"name": ["テスト通り"], "name:en": ["Test Dori"],
                                "osm_way_id": [123], "geometry": [LineString([(0, 0), (1, 0)])]},
                               crs=road_ui.MATCHER.METRIC_CRS)
        context.return_value = (ROAD, Path(), osm, osm.geometry.iloc[0], {}, {"componentCount": 1})
        result = road_ui.inspect_osm(ROAD)
        self.assertEqual(result["summary"]["wayCount"], 1)
        self.assertIn("Test Dori", result["discoveredNames"])

    def test_geojson_preserves_and_serializes_pandas_and_numpy_scalars(self):
        frame = gpd.GeoDataFrame({
            "N13_001": [pd.Timestamp("2024-04-01T12:34:56")],
            "featureCount": np.array([np.int64(7)]),
            "residual": np.array([np.float64(3.25)]),
            "geometry": [LineString([(139.0, 35.0), (139.1, 35.1)])],
        }, crs="EPSG:4326")

        geojson = road_ui._geojson(frame)
        properties = geojson["features"][0]["properties"]
        self.assertEqual(properties["N13_001"], "2024-04-01 12:34:56")
        self.assertEqual(properties["featureCount"], 7)
        self.assertEqual(properties["residual"], 3.25)
        # Exercise the same outer encoding performed by server.Handler._send
        # with every GeoJSON-bearing field in a complete preview response.
        response = {
            "reference": geojson,
            "candidates": geojson,
            "residualPass": geojson,
            "selected": geojson,
            "diagnostics": geojson,
            "report": {"candidateCount": np.int64(1)},
        }
        # The GeoJSON portions themselves must pass strict standard encoding.
        json.dumps({key: value for key, value in response.items() if key != "report"})
        # The HTTP boundary also safely handles any numpy/date-like diagnostic
        # scalar that an existing matcher report happens to expose.
        json.dumps(response, default=str)

    @patch.object(road_ui, "_context")
    @patch.object(road_ui.MATCHER, "load_n13_candidates")
    @patch.object(road_ui.MATCHER, "match_n13")
    @patch.object(road_ui, "metadata", return_value={})
    def test_n13_analysis_summary(self, _, match, load, context):
        frame = gpd.GeoDataFrame({"N13_003": ["2"], "match_median_m": [4.0],
                                  "geometry": [LineString([(0, 0), (10, 0)])]}, crs=road_ui.MATCHER.METRIC_CRS)
        context.return_value = (ROAD, Path(), None, frame.geometry.iloc[0], {}, {})
        load.return_value = frame
        match.return_value = (frame, frame)
        summary = road_ui.analyze_n13(ROAD)["classes"][0]
        self.assertEqual(summary["residualPassFeatures"], 1)
        self.assertTrue(summary["suggested"])

    def test_missing_partition_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Path(directory) / "sources.json"
            sources.write_text(json.dumps({"osm": {}, "n13": {"cache": directory + "/missing"}}))
            self.assertEqual(len(road_ui.metadata(sources)["missingClasses"]), 6)

    @patch.object(road_ui.MATCHER, "load_source_config")
    def test_prepare_class_safe_direct_invocation(self, config):
        root = Path(self.temp.name) / "cache"
        raw = Path(self.temp.name) / "raw.geojson"
        raw.write_text("{}")
        root.mkdir()
        (root / "manifest.json").write_text(json.dumps({"source": str(raw), "availableClasses": []}))
        config.return_value = {"n13": {"cache": str(root)}}
        runner = Mock(return_value={"classes": ["5"]})
        self.assertEqual(road_ui.prepare_class("5", runner=runner)["classes"], ["5"])
        runner.assert_called_once_with(raw, root, ["5"])

    @patch.object(road_ui, "_context", side_effect=RuntimeError("preview stopped"))
    def test_preview_never_modifies_registry(self, _):
        before = self.registry.read_bytes()
        with self.assertRaises(RuntimeError):
            road_ui.preview_match(ROAD)
        self.assertEqual(self.registry.read_bytes(), before)

    def test_save_and_build_invokes_existing_pipeline(self):
        completed = subprocess.CompletedProcess([], 0, stdout="ok", stderr="")
        runner = Mock(return_value=completed)
        road_ui.build_road(ROAD["id"], self.registry, runner)
        command = runner.call_args.args[0]
        self.assertEqual(Path(command[1]).name, "build-road.py")
        self.assertNotIsInstance(command, str)

    def test_project_crud_is_atomic_and_does_not_build_or_touch_registry(self):
        root = Path(self.temp.name); (root / "projects").mkdir()
        registry = root / "data/roads/registry.json"; registry.parent.mkdir(parents=True)
        registry.write_text('{"roads": []}')
        project = {"id":"demo", "displayName":"Demo", "bounds":[139,35,140,36], "layers":{}}
        before = registry.read_bytes()
        with patch.object(road_ui, "build_project") as build:
            road_ui.save_project(project, root=root)
            self.assertEqual(road_ui.list_projects(root), [{"id":"demo","displayName":"Demo"}])
            self.assertEqual(road_ui.load_project("demo", root)["id"], "demo")
            project["displayName"] = "Updated"; road_ui.save_project(project, "demo", root)
            self.assertEqual(road_ui.load_project("demo", root)["displayName"], "Updated")
            build.assert_not_called()
        self.assertEqual(registry.read_bytes(), before)
        self.assertFalse(list((root / "projects/demo").glob(".project-*")))

    def test_rejects_unsafe_project_ids(self):
        for value in ("../bad", "/bad", "bad/name", "Bad"):
            with self.assertRaises(ValueError): road_ui.validate_project_id(value)

    def test_project_catalog_status_and_routes_are_resilient(self):
        root = Path(self.temp.name); (root / "data/roads").mkdir(parents=True)
        (root / "data/roads/registry.json").write_text(json.dumps({"roads":[{"id":"built","displayName":"Built"},{"id":"missing","displayName":"Missing"}]}))
        (root / "public/data/roads").mkdir(parents=True); (root / "public/data/roads/built-n13.geojson").write_text("{}")
        missing = road_ui.project_catalog(root)
        self.assertEqual([r["built"] for r in missing["modernRoads"]], [True, False])
        self.assertFalse(missing["availability"]["codh"]["ready"]); self.assertFalse(missing["availability"]["rail"]["ready"])
        index = root / "data/cache/codh/edo-roads/index.json"; index.parent.mkdir(parents=True)
        index.write_text(json.dumps([{"routeId":"R003","name":"甲州道中","altName":"甲州街道"}]))
        self.assertEqual(road_ui.project_catalog(root)["historicalRoutes"][0]["routeId"], "R003")

    @patch.object(road_ui, "ROOT")
    def test_project_build_reuses_materializer_and_preview_returns_layers(self, _):
        root = Path(self.temp.name); (root / "scripts").mkdir()
        manifest = {"featureCounts":{"modernRoads":1},"bounds":[139,35,140,36]}
        fake = Mock(); fake.materialize_project.return_value = manifest
        with patch.dict("sys.modules", {"project_builder":fake}):
            result = road_ui.build_project("demo", root)
        fake.materialize_project.assert_called_once_with(root, "demo"); self.assertEqual(result["counts"]["modernRoads"], 1)
        output = root / "public/projects/demo/data"; output.mkdir(parents=True)
        (output.parent / "manifest.json").write_text(json.dumps(manifest))
        for name in ("modern-roads","railways","stations","historical-roads","historical-posts"):
            (output / f"{name}.geojson").write_text('{"type":"FeatureCollection","features":[]}')
        self.assertEqual(road_ui.project_preview("demo", root)["manifest"]["bounds"], [139,35,140,36])


if __name__ == "__main__":
    unittest.main()
