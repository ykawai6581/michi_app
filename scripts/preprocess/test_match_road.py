"""Synthetic regression tests for N13 display-geometry stitching."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import LineString


SPEC = importlib.util.spec_from_file_location("match_road", Path(__file__).with_name("match-road.py"))
MATCH_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATCH_ROAD)


def stitch(lines, reference=None, tolerance=2):
    reference = reference or LineString([(-100, 0), (200, 0)])
    return MATCH_ROAD.build_display_chains(lines, reference, {"endpointSnapMeters": tolerance})


class DisplayChainTests(unittest.TestCase):
    def test_three_touching_collinear_segments_become_one(self):
        geometry, report = stitch([LineString([(0, 0), (10, 0)]), LineString([(10, 0), (20, 0)]), LineString([(20, 0), (30, 0)])])
        self.assertEqual(geometry.geom_type, "LineString")
        self.assertEqual(report["displayChainCount"], 1)

    def test_one_meter_gaps_are_snapped(self):
        geometry, report = stitch([LineString([(0, 0), (10, 0)]), LineString([(11, 0), (20, 0)]), LineString([(21, 0), (30, 0)])])
        self.assertEqual(geometry.geom_type, "LineString")
        self.assertEqual(report["endpointSnapCount"], 2)
        self.assertEqual(report["maximumSnappedGapMeters"], 1)

    def test_twenty_meter_gap_remains(self):
        geometry, report = stitch([LineString([(0, 0), (10, 0)]), LineString([(30, 0), (40, 0)])])
        self.assertEqual(geometry.geom_type, "MultiLineString")
        self.assertEqual(report["displayChainCount"], 2)

    def test_t_junction_continues_main_road(self):
        geometry, report = stitch([LineString([(0, 0), (10, 0)]), LineString([(10, 0), (20, 0)]), LineString([(10, 0), (10, 8)])])
        self.assertEqual(report["displayChainCount"], 2)
        self.assertIn(20, sorted(round(part.length) for part in geometry.geoms))

    def test_parallel_carriageways_remain_separate(self):
        lines = [LineString([(0, 0), (10, 0)]), LineString([(10, 0), (20, 0)]),
                 LineString([(0, 5), (10, 5)]), LineString([(10, 5), (20, 5)])]
        geometry, report = stitch(lines, LineString([(-10, 2.5), (30, 2.5)]))
        self.assertEqual(geometry.geom_type, "MultiLineString")
        self.assertEqual(report["displayChainCount"], 2)

    def test_route_20_output_has_substantially_fewer_display_chains(self):
        report_path = Path(__file__).parents[2] / "public/data/roads/jp-national-20.report.json"
        processing = json.loads(report_path.read_text())["geometryProcessing"]
        self.assertLess(processing["displayChainCount"], processing["sourceSegmentCount"] / 4)


class SourceArchitectureTests(unittest.TestCase):
    def test_candidate_loading_filters_class_without_a_bbox(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "roads.parquet"
            gpd.GeoDataFrame({"N13_003": ["1", "2"], "geometry": [
                LineString([(130, 30), (131, 30)]), LineString([(140, 36), (141, 36)])]},
                crs="EPSG:4326").to_parquet(path)
            candidates = MATCH_ROAD.load_n13_candidates({"n13": {"classification": "1"}}, path)
            self.assertEqual(len(candidates), 1)
            self.assertGreater(candidates.geometry.iloc[0].length, 90_000)

    def test_cached_osm_reference_is_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"; cache.mkdir()
            path = cache / "jp-national-20-osm.geojson"
            gpd.GeoDataFrame({"ref": ["20"], "geometry": [LineString([(139, 35), (140, 35)])]},
                             crs="EPSG:4326").to_file(path, driver="GeoJSON")
            frame, provenance = MATCH_ROAD.build_osm_reference(
                {"id": "jp-national-20"}, {"osm": {"provider": "auto", "cacheDirectory": str(cache)}})
            self.assertEqual(len(frame), 1)
            self.assertEqual(provenance["provider"], "cache")

    def test_provider_uses_configured_statutory_identity_and_bounds(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "tokyo-prefectural-318")
        config = {"osm": {"provider": "overpass", "cacheDirectory": "/tmp/unused", "overpass": {
            "endpoint": "https://example.test", "boundsByJurisdiction": {"Tokyo": [1, 2, 3, 4]}}}}
        with patch.object(MATCH_ROAD, "download_reference") as download, patch.object(
                MATCH_ROAD.gpd, "read_file", return_value=gpd.GeoDataFrame(geometry=[])):
            MATCH_ROAD.build_osm_reference(road, config, refresh=True)
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('["ref"="318"]', query)
        self.assertIn("(2,1,4,3)", query)
        self.assertEqual(download.call_args.args[3], [1, 2, 3, 4])

    def test_registry_contains_current_statutory_roads(self):
        for road_id in ("jp-national-20", "jp-national-246", "tokyo-prefectural-318", "tokyo-prefectural-311"):
            self.assertEqual(MATCH_ROAD.load_road(Path("data/roads/registry.json"), road_id)["id"], road_id)


if __name__ == "__main__":
    unittest.main()
