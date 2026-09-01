"""Synthetic regression tests for N13 display-geometry stitching."""

import importlib.util
import json
import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import LineString, MultiLineString


SPEC = importlib.util.spec_from_file_location("match_road", Path(__file__).with_name("match-road.py"))
MATCH_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATCH_ROAD)


def stitch(lines, reference=None, tolerance=2):
    reference = reference or LineString([(-100, 0), (200, 0)])
    return MATCH_ROAD.build_display_chains(lines, reference, {"endpointSnapMeters": tolerance})


def select(lines, reference, classes=None, **settings):
    classes = classes or ["2"] * len(lines)
    frame = gpd.GeoDataFrame({
        "N13_003": classes,
        "match_min_m": [line.distance(reference) for line in lines],
        "match_median_m": [line.distance(reference) for line in lines],
        "match_p90_m": [line.distance(reference) for line in lines],
        "geometry": lines,
    }, crs=MATCH_ROAD.METRIC_CRS)
    return MATCH_ROAD.select_reference_network(frame, reference, settings)


class NetworkSelectionTests(unittest.TestCase):
    def test_straight_road_rejects_short_t_spur(self):
        accepted, diagnostic, _ = select([
            LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
            LineString([(50, 0), (50, 20)])], LineString([(0, 0), (100, 0)]))
        self.assertEqual(len(accepted), 2)
        self.assertEqual(diagnostic.iloc[2].selectionStatus, "rejected-spur")

    def test_straight_road_rejects_diagonal_spur(self):
        accepted, diagnostic, _ = select([
            LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
            LineString([(50, 0), (65, 12)])], LineString([(0, 0), (100, 0)]))
        self.assertEqual(len(accepted), 2)
        self.assertTrue(diagnostic.iloc[2].selectionStatus.startswith("rejected-"))

    def test_triangular_excursion_is_rejected_as_redundant_detour(self):
        lines = [LineString([(0, 0), (25, 0)]), LineString([(25, 0), (50, 0)]),
                 LineString([(50, 0), (75, 0)]), LineString([(75, 0), (100, 0)]),
                 LineString([(25, 0), (50, 12)]), LineString([(50, 12), (75, 0)])]
        accepted, diagnostic, _ = select(lines, LineString([(0, 0), (100, 0)]))
        self.assertAlmostEqual(accepted.geometry.length.sum(), 100)
        self.assertTrue(all(value.startswith("rejected-") for value in diagnostic.iloc[4:].selectionStatus))

    def test_large_rejoining_loop_loses_to_direct_alignment(self):
        lines = [LineString([(0, 0), (40, 0)]), LineString([(40, 0), (80, 0)]),
                 LineString([(0, 0), (20, 25), (60, 25), (80, 0)])]
        accepted, diagnostic, _ = select(lines, LineString([(0, 0), (80, 0)]))
        self.assertAlmostEqual(accepted.geometry.length.sum(), 80)
        self.assertEqual(diagnostic.iloc[2].selectionStatus, "rejected-detour")

    def test_curved_legitimate_road_is_retained(self):
        reference = LineString([(0, 0), (30, 5), (60, 20), (90, 45)])
        accepted, _, _ = select([LineString([(0, 0), (30, 5)]), LineString([(30, 5), (60, 20), (90, 45)])], reference)
        self.assertEqual(len(accepted), 2)

    def test_long_divided_carriageway_retains_parallel_chain(self):
        reference = MultiLineString([[(0, 0), (300, 0)], [(0, 4), (300, 4)]])
        lines = [LineString([(0, 0), (150, 0)]), LineString([(150, 0), (300, 0)]),
                 LineString([(0, 4), (150, 4)]), LineString([(150, 4), (300, 4)])]
        accepted, diagnostic, report = select(lines, reference)
        self.assertEqual(len(accepted), 4)
        self.assertEqual(report["parallelSelectedCount"], 2)
        self.assertIn("accepted-parallel-osm-supported", set(diagnostic.selectionStatus))

    def test_multiple_oblique_stems_with_progress_are_rejected(self):
        reference = LineString([(0, 0), (150, 0), (300, 10)])
        road = [LineString([(0, 0), (100, 0)]), LineString([(100, 0), (200, 3)]),
                LineString([(200, 3), (300, 10)])]
        stems = [LineString([(40, 0), (65, 16)]), LineString([(130, .9), (165, 22)]),
                 LineString([(240, 5.8), (280, 28)])]
        accepted, diagnostic, _ = select(road + stems, reference)
        self.assertEqual(set(accepted.sourceFeatureIndex), {0, 1, 2})
        self.assertTrue(all(status == "rejected-spur" for status in diagnostic.iloc[3:].selectionStatus))

    def test_long_connected_false_parallel_has_no_osm_support(self):
        reference = LineString([(0, 0), (400, 0)])
        road = [LineString([(0, 0), (200, 0)]), LineString([(200, 0), (400, 0)])]
        false_parallel = [LineString([(50, 0), (65, 14), (200, 14)]),
                          LineString([(200, 14), (335, 14), (350, 0)])]
        accepted, diagnostic, report = select(road + false_parallel, reference)
        self.assertEqual(set(accepted.sourceFeatureIndex), {0, 1})
        self.assertEqual(report["parallelSelectedCount"], 0)
        self.assertTrue(all(status in {"rejected-detour", "rejected-redundant-parallel"}
                            for status in diagnostic.iloc[2:].selectionStatus))

    def test_awkward_connector_is_available_to_ordered_path(self):
        reference = LineString([(0, 0), (200, 0)])
        lines = [LineString([(0, 0), (100, 0)]),
                 LineString([(100, 0), (105, 22), (110, 0)]),
                 LineString([(110, 0), (200, 0)])]
        accepted, diagnostic, _ = select(lines, reference)
        self.assertEqual(set(accepted.sourceFeatureIndex), {0, 1, 2})
        self.assertTrue(diagnostic.iloc[1].gapRepairMembership)

    def test_internal_gap_is_repaired_through_stage1_graph(self):
        reference = LineString([(0, 0), (220, 0)])
        lines = [LineString([(0, 0), (90, 0)]),
                 LineString([(90, 0), (105, 28), (125, 28), (140, 0)]),
                 LineString([(140, 0), (220, 0)])]
        accepted, diagnostic, report = select(lines, reference, maximumSampleDistanceMeters=15)
        self.assertEqual(set(accepted.sourceFeatureIndex), {0, 1, 2})
        self.assertTrue(diagnostic.iloc[1].gapRepairMembership)
        self.assertTrue(report["repairedGaps"] or diagnostic.iloc[1].selectionReason == "accepted-gap-repair")

    def test_short_parallel_slip_detour_is_rejected(self):
        reference = LineString([(0, 0), (200, 0)])
        lines = [LineString([(0, 0), (100, 0)]), LineString([(100, 0), (200, 0)]),
                 LineString([(60, 0), (80, 5), (110, 5), (130, 0)])]
        accepted, diagnostic, _ = select(lines, reference)
        self.assertEqual(len(accepted), 2)
        self.assertEqual(diagnostic.iloc[2].selectionStatus, "rejected-detour")

    def test_class_transition_does_not_break_backbone(self):
        lines = [LineString([(0, 0), (40, 0)]), LineString([(40, 0), (70, 0)]), LineString([(70, 0), (100, 0)])]
        accepted, _, _ = select(lines, LineString([(0, 0), (100, 0)]), ["2", "3", "2"])
        self.assertEqual(list(accepted.N13_003), ["2", "3", "2"])

    def test_tiny_endpoint_gap_uses_existing_snap_tolerance(self):
        lines = [LineString([(0, 0), (50, 0)]), LineString([(51, 0), (100, 0)])]
        accepted, _, _ = select(lines, LineString([(0, 0), (100, 0)]), endpointSnapMeters=2)
        self.assertEqual(len(accepted), 2)
        _, report = stitch(list(accepted.geometry), LineString([(0, 0), (100, 0)]), 2)
        self.assertEqual(report["displayChainCount"], 1)

    def test_disconnected_reference_components_are_not_bridged(self):
        reference = MultiLineString([[(0, 0), (100, 0)], [(1000, 0), (1100, 0)]])
        lines = [LineString([(0, 0), (100, 0)]), LineString([(1000, 0), (1100, 0)])]
        accepted, diagnostic, _ = select(lines, reference)
        self.assertEqual(len(accepted), 2)
        self.assertEqual(set(diagnostic.referencePart), {0, 1})

    def test_source_boundary_terminal_is_not_pruned_as_spur(self):
        reference = LineString([(0, 0), (150, 0)])
        lines = [LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)])]
        accepted, diagnostic, _ = select(lines, reference)
        self.assertEqual(len(accepted), 2)
        self.assertTrue(all(diagnostic.selectionStatus == "accepted-backbone"))


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
            candidates = MATCH_ROAD.load_n13_candidates({"n13": {"classifications": ["1"]}}, path)
            self.assertEqual(len(candidates), 1)
            self.assertGreater(candidates.geometry.iloc[0].length, 90_000)

    def test_candidate_loading_reads_only_requested_class_partition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "roads"
            for road_class in ("1", "2"):
                partition = root / f"class={road_class}"; partition.mkdir(parents=True)
                gpd.GeoDataFrame({"N13_003": [road_class], "geometry": [LineString([(139, 35), (140, 35)])]},
                                 crs="EPSG:4326").to_parquet(partition / "roads.parquet")
            candidates = MATCH_ROAD.load_n13_candidates({"n13": {"classifications": ["2"]}}, root)
            self.assertEqual(set(candidates["N13_003"]), {"2"})

    def test_candidate_loading_normalizes_legacy_parquet_root_name(self):
        with tempfile.TemporaryDirectory() as directory:
            requested = Path(directory) / "roads.parquet"
            requested.write_text("old cache")
            partition = Path(directory) / "roads/class=1"; partition.mkdir(parents=True)
            gpd.GeoDataFrame({"N13_003": ["1"], "geometry": [LineString([(139, 35), (140, 35)])]},
                             crs="EPSG:4326").to_parquet(partition / "roads.parquet")
            candidates = MATCH_ROAD.load_n13_candidates({"n13": {"classifications": ["1"]}}, requested)
            self.assertEqual(len(candidates), 1)

    def test_cached_osm_reference_is_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"; cache.mkdir()
            path = cache / "jp-national-20-osm.geojson"
            gpd.GeoDataFrame({"ref": ["20"], "geometry": [LineString([(139, 35), (140, 35)])]},
                             crs="EPSG:4326").to_file(path, driver="GeoJSON")
            identity = {"type": "osm-ref", "ref": "20", "network": "JP:national"}
            path.with_suffix(".meta.json").write_text(json.dumps({
                "coverageBoundsWgs84": [138, 34, 141, 36], "referenceIdentity": identity}))
            frame, provenance = MATCH_ROAD.build_osm_reference(
                {"id": "jp-national-20", "reference": identity},
                {"osm": {"provider": "auto", "cacheDirectory": str(cache)}},
                [139.2, 34.9, 139.8, 35.1])
            self.assertEqual(len(frame), 1)
            self.assertEqual(provenance["provider"], "cache")
            self.assertLessEqual(frame.total_bounds[0], 139.2 + 1e-7)
            self.assertGreaterEqual(frame.total_bounds[2], 139.8 - 1e-7)

    def test_smaller_cached_extent_is_not_reused_after_n13_expands(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"; cache.mkdir()
            path = cache / "jp-national-20-osm.geojson"
            gpd.GeoDataFrame({"ref": ["20"], "geometry": [LineString([(139, 35), (139.1, 35)])]},
                             crs="EPSG:4326").to_file(path, driver="GeoJSON")
            path.with_suffix(".meta.json").write_text(json.dumps({"coverageBoundsWgs84": [139, 35, 139.1, 35.1]}))
            road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "jp-national-20")
            config = {"osm": {"provider": "overpass", "cacheDirectory": str(cache),
                              "overpass": {"endpoint": "https://example.test"}}}
            with patch.object(MATCH_ROAD, "download_reference") as download, patch.object(
                    MATCH_ROAD.gpd, "read_file", return_value=gpd.GeoDataFrame(
                        {"ref": ["20"], "geometry": [LineString([(139, 35), (140, 35)])]}, crs="EPSG:4326")):
                MATCH_ROAD.build_osm_reference(road, config, [139, 35, 140, 35.1])
            download.assert_called_once()

    def test_provider_uses_configured_statutory_identity_and_bounds(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "tokyo-prefectural-318")
        config = {"osm": {"provider": "overpass", "cacheDirectory": "/tmp/unused", "overpass": {
            "endpoint": "https://example.test", "boundsByJurisdiction": {"Tokyo": [1, 2, 3, 4]}}}}
        with patch.object(MATCH_ROAD, "download_reference") as download, patch.object(
                MATCH_ROAD.gpd, "read_file", return_value=gpd.GeoDataFrame(geometry=[])):
            MATCH_ROAD.build_osm_reference(road, config, [1, 2, 3, 4], refresh=True)
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('["ref"="318"]', query)
        self.assertIn("(2,1,4,3)", query)
        self.assertEqual(download.call_args.args[3], [1, 2, 3, 4])

    def test_route_20_and_named_query_use_n13_bounds_not_jurisdiction(self):
        bounds = [139.5, 35.5, 139.8, 35.8]
        config = {"osm": {"provider": "overpass", "cacheDirectory": "/tmp/unused", "overpass": {
            "endpoint": "https://example.test", "boundsByJurisdiction": {"JP": [122, 20, 154, 46]}}}}
        for road_id in ("jp-national-20", "tokyo-named-koshu-kaido"):
            road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), road_id)
            with patch.object(MATCH_ROAD, "download_reference") as download, patch.object(
                    MATCH_ROAD.gpd, "read_file", return_value=gpd.GeoDataFrame(
                        {"ref": ["20"], "name": ["甲州街道"], "geometry": [LineString([(139.5, 35.6), (139.7, 35.6)])]},
                        crs="EPSG:4326")):
                MATCH_ROAD.build_osm_reference(road, config, bounds, refresh=True)
            self.assertEqual(download.call_args.args[3], bounds)
        query = MATCH_ROAD.osm_query(
            MATCH_ROAD.load_road(Path("data/roads/registry.json"), "tokyo-named-koshu-kaido"), bounds)
        self.assertIn('["name"="甲州街道"](35.5,139.5,35.8,139.8)', query)
        self.assertNotIn("(20,122,46,154)", query)

    def test_registry_contains_current_statutory_roads(self):
        for road_id in ("jp-national-20", "jp-national-246", "tokyo-prefectural-318", "tokyo-prefectural-311"):
            self.assertEqual(MATCH_ROAD.load_road(Path("data/roads/registry.json"), road_id)["id"], road_id)

    def test_statutory_reference_query_uses_one_ref(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "jp-national-20")
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('["ref"="20"]', query)
        self.assertNotIn("甲州街道", query)

    def test_networked_statutory_query_uses_only_exact_relation_members(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "jp-national-20")
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('["network"="JP:national"]', query)
        self.assertIn("way(r.r)", query)
        self.assertNotIn('way["highway"]["ref"="20"]', query)
        self.assertNotIn(".w;", query)

        prefectural = {**road, "reference": {"type": "osm-ref", "ref": "20",
                                              "network": "JP:prefectural"}}
        prefectural_query = MATCH_ROAD.osm_query(prefectural, [1, 2, 3, 4])
        self.assertIn('["network"="JP:prefectural"]', prefectural_query)
        self.assertNotIn('JP:national', prefectural_query)
        different_n13 = {**road, "n13": {"classifications": ["6"]}}
        self.assertEqual(MATCH_ROAD.osm_query(different_n13, [1, 2, 3, 4]), query)

    def test_direct_way_fallback_preserves_network_identity(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "jp-national-20")
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4], direct_fallback=True)
        self.assertIn('way["highway"]["ref"="20"]["network"="JP:national"]', query)

    def test_networkless_statutory_query_warns_and_retains_legacy_behavior(self):
        road = {"reference": {"type": "osm-ref", "ref": "20"}}
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('way["highway"]["ref"="20"]', query)
        self.assertIn("without a network", str(caught[0].message))

    def test_local_networked_reference_rejects_lines_without_network_identity(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "jp-national-20")
        frame = gpd.GeoDataFrame({"ref": ["20", "20"], "geometry": [
            LineString([(0, 0), (1, 0)]), LineString([(0, 1), (1, 1)])]}, crs="EPSG:4326")
        with patch.object(MATCH_ROAD.gpd, "read_file", return_value=frame):
            with self.assertRaisesRegex(RuntimeError, "cannot establish exact network"):
                MATCH_ROAD._local_osm_reference(road, Path("roads.pbf"))

        frame["network"] = ["JP:national", "JP:prefectural"]
        with patch.object(MATCH_ROAD.gpd, "read_file", return_value=frame):
            selected = MATCH_ROAD._local_osm_reference(road, Path("roads.pbf"))
        self.assertEqual(list(selected.network), ["JP:national"])

    def test_named_reference_query_uses_exact_name_and_alternates(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "tokyo-named-inokashira-dori")
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('["name"="井ノ頭通り"]', query)
        self.assertIn('["name:ja"="井の頭通り"]', query)
        self.assertIn('["alt_name"="井ノ頭通り"]', query)
        self.assertNotIn("~", query)

    def test_named_road_loads_multiple_n13_classes_and_rejects_nearby_feature(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for road_class, geometries in (("2", [LineString([(139, 35), (139.01, 35)]),
                                                     LineString([(139, 35.001), (139.01, 35.001)])]),
                                           ("3", [LineString([(139.01, 35), (139.02, 35)])])):
                partition = root / f"class={road_class}"; partition.mkdir()
                gpd.GeoDataFrame({"N13_003": [road_class] * len(geometries), "geometry": geometries},
                                 crs="EPSG:4326").to_parquet(partition / "roads.parquet")
            entity = {"n13": {"classifications": ["2", "3"]}, "matching": {
                "sampleIntervalMeters": 5, "maximumMedianResidualMeters": 20, "maximumP90ResidualMeters": 25}}
            all_candidates = MATCH_ROAD.load_n13_candidates(entity, root)
            reference = all_candidates[all_candidates.geometry.centroid.y < all_candidates.geometry.centroid.y.min() + 1].geometry.union_all()
            candidates = MATCH_ROAD.load_n13_candidates(entity, root, reference)
            selected, _ = MATCH_ROAD.match_n13(candidates, reference, entity)
            self.assertEqual(set(selected.N13_003), {"2", "3"})
            self.assertEqual(len(selected), 2)
            self.assertEqual(candidates.attrs["classDiagnostics"]["2"]["partitionFeatureCount"], 2)
            self.assertEqual(candidates.attrs["classDiagnostics"]["2"]["spatiallyShortlistedCount"], 1)
            self.assertEqual(candidates.attrs["classDiagnostics"]["3"]["residualTestedCount"], 1)

    def test_local_osm_reference_is_clipped_to_n13_bounds(self):
        road = MATCH_ROAD.load_road(Path("data/roads/registry.json"), "tokyo-named-koshu-kaido")
        frame = gpd.GeoDataFrame({"name": ["甲州街道"], "geometry": [
            LineString([(139, 35.5), (140, 35.5)])]}, crs="EPSG:4326")
        clipped = MATCH_ROAD.clip_osm_to_bounds(frame, [139.25, 35.4, 139.75, 35.6])
        self.assertAlmostEqual(clipped.total_bounds[0], 139.25)
        self.assertAlmostEqual(clipped.total_bounds[2], 139.75)

    def test_search_index_contains_only_materialized_roads(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "registry.json"
            registry.write_text(json.dumps({"roads": [
                {"id": "built", "displayName": "Built", "aliases": [], "entityType": "named-road"},
                {"id": "missing", "displayName": "Missing", "aliases": [], "entityType": "named-road"},
            ]}))
            public, search = Path(directory) / "roads", Path(directory) / "roads.json"
            public.mkdir()
            for source in ("n13", "osm"):
                (public / f"built-{source}.geojson").write_text("{}")
            with patch.object(MATCH_ROAD, "PUBLIC_ROADS", public), patch.object(MATCH_ROAD, "SEARCH_INDEX", search):
                MATCH_ROAD.rebuild_search_index(registry)
            self.assertEqual([entry["id"] for entry in json.loads(search.read_text())], ["built"])

    def test_disconnected_same_name_reference_is_not_bridged(self):
        osm = gpd.GeoDataFrame({"name": ["test", "test"], "geometry": [
            LineString([(139, 35), (139.01, 35)]), LineString([(140, 36), (140.01, 36)])]}, crs="EPSG:4326")
        geometry, report = MATCH_ROAD.build_reference(
            {"reference": {"type": "osm-name", "names": ["test"]}}, osm)
        self.assertIsInstance(geometry, MultiLineString)
        self.assertEqual(report["connectedComponentCount"], 2)
        self.assertEqual(report["syntheticBridgesAdded"], 0)


if __name__ == "__main__":
    unittest.main()
