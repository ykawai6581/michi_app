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


if __name__ == "__main__":
    unittest.main()
