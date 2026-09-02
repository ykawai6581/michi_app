"""Synthetic regression tests for N13 display-geometry stitching."""

import importlib.util
import io
import json
import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import MagicMock, patch

import geopandas as gpd
from shapely.geometry import LineString, MultiLineString


SPEC = importlib.util.spec_from_file_location("match_road", Path(__file__).with_name("match-road.py"))
MATCH_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATCH_ROAD)


def stitch(lines, reference=None, tolerance=2):
    reference = reference or LineString([(-100, 0), (200, 0)])
    return MATCH_ROAD.build_display_chains(lines, reference, {"endpointSnapMeters": tolerance})


def select(lines, reference, classes=None, **settings):
    progress_callback = settings.pop("progress_callback", None)
    classes = classes or ["2"] * len(lines)
    frame = gpd.GeoDataFrame({
        "N13_003": classes,
        "match_min_m": [line.distance(reference) for line in lines],
        "match_median_m": [line.distance(reference) for line in lines],
        "match_p90_m": [line.distance(reference) for line in lines],
        "geometry": lines,
    }, crs=MATCH_ROAD.METRIC_CRS)
    return MATCH_ROAD.select_reference_network(frame, reference, settings, progress_callback)


class ReferenceOwnershipTests(unittest.TestCase):
    def assert_curated_rows_unchanged(self, curated, connected):
        for _, row in curated.iterrows():
            matches = connected[
                (connected.sourceFeatureIndex == row.sourceFeatureIndex)
                & (connected.sourceStartDistanceMeters == row.sourceStartDistanceMeters)
                & (connected.sourceEndDistanceMeters == row.sourceEndDistanceMeters)]
            self.assertTrue(any(candidate.wkb == row.geometry.wkb for candidate in matches.geometry))

    def test_progress_callback_reports_actual_reference_sample_work_without_changing_output(self):
        lines = [LineString([(0, 0), (100, 0)])]
        reference = LineString([(0, 0), (100, 0)])
        baseline, _, baseline_report = select(lines, reference, ["1"], classPriority=["1"])
        updates = []
        instrumented, _, instrumented_report = select(
            lines, reference, ["1"], classPriority=["1"],
            progress_callback=lambda **value: updates.append(value))
        self.assertTrue(any(item.get("completed") and item.get("total") for item in updates))
        self.assertEqual([item["progress"] for item in updates], sorted(item["progress"] for item in updates))
        self.assertTrue(baseline.geometry.equals(instrumented.geometry))
        self.assertEqual(baseline_report, instrumented_report)

    def connect(self, lines, reference, classes, **settings):
        accepted, _, _ = select(lines, reference, classes, **settings)
        stage1 = gpd.GeoDataFrame({"N13_003": classes, "sourceFeatureIndex": range(len(lines)),
                                   "geometry": lines}, crs=MATCH_ROAD.METRIC_CRS)
        return MATCH_ROAD.connect_adjacent_selected_runs(accepted, stage1, reference, settings)

    def test_straight_road_rejects_t_stem(self):
        accepted, diagnostic, _ = select([
            LineString([(0, 0), (100, 0)]), LineString([(50, 0), (50, 30)])],
            LineString([(0, 0), (100, 0)]), ["1", "2"], classPriority=["1", "2"])
        self.assertEqual(set(accepted.sourceFeatureIndex), {0})
        self.assertEqual(diagnostic.iloc[1].selectionStatus, "rejected-no-owned-run")

    def test_shallow_parallel_stem_owns_no_sustained_run(self):
        accepted, _, _ = select([LineString([(0, 0), (120, 0)]),
                                  LineString([(20, 0), (40, 8), (100, 8)])],
                                 LineString([(0, 0), (120, 0)]), ["1", "2"],
                                 classPriority=["1", "2"])
        self.assertEqual(set(accepted.sourceFeatureIndex), {0})

    def test_lower_class_fills_unresolved_second_half(self):
        accepted, _, report = select([LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)])],
                                     LineString([(0, 0), (100, 0)]), ["1", "2"],
                                     classPriority=["1", "2"])
        self.assertEqual(set(accepted.N13_003), {"1", "2"})
        self.assertGreater(report["referencePartInference"][0]["matchedSampleCount"], 15)

    def test_lower_overlap_is_emitted_only_for_unresolved_substring(self):
        accepted, _, _ = select([LineString([(0, 0), (55, 0)]), LineString([(0, 2), (100, 2)])],
                                LineString([(0, 0), (100, 0)]), ["1", "2"],
                                classPriority=["1", "2"])
        lower = accepted[accepted.N13_003 == "2"].iloc[0]
        self.assertGreater(lower.sourceStartDistanceMeters, 45)
        self.assertLess(lower.geometry.length, 55)

    def test_short_higher_class_island_does_not_lock_samples(self):
        accepted, _, _ = select([LineString([(48, 0), (52, 0)]), LineString([(0, 1), (100, 1)])],
                                LineString([(0, 0), (100, 0)]), ["1", "2"],
                                classPriority=["1", "2"], minimumOwnedReferenceSamples=3)
        self.assertEqual(set(accepted.N13_003), {"2"})

    def test_multipart_reference_has_independent_winners(self):
        reference = MultiLineString([[(0, 0), (100, 0)], [(0, 10), (100, 10)]])
        accepted, _, _ = select([LineString([(0, 0), (100, 0)]), LineString([(0, 10), (100, 10)])],
                                reference, ["1", "2"], classPriority=["1", "2"])
        self.assertEqual(set(accepted.referencePart), {0, 1})

    def test_same_class_parallel_carriageways_keep_independent_owners(self):
        reference = MultiLineString([[(0, 0), (100, 0)], [(0, 8), (100, 8)]])
        accepted, _, report = select(
            [LineString([(0, 0), (100, 0)]), LineString([(0, 8), (100, 8)])],
            reference, ["1", "1"], classPriority=["1"])
        self.assertEqual(set(accepted.sourceFeatureIndex), {0, 1})
        self.assertEqual(report["crossClassParallelRejectedSampleCount"], 0)

    def test_cross_class_parallel_part_is_rejected_even_when_beyond_candidate_radius(self):
        reference = MultiLineString([[(0, 0), (100, 0)], [(0, 40), (100, 40)]])
        accepted, ownership, report = select(
            [LineString([(0, 0), (100, 0)]), LineString([(0, 40), (100, 40)])],
            reference, ["1", "3"], classPriority=["1", "3"],
            maximumSampleDistanceMeters=35, crossClassParallelSearchMeters=50)
        self.assertEqual(set(accepted.N13_003), {"1"})
        self.assertGreater(report["crossClassParallelRejectedSampleCount"], 0)
        samples = ownership.attrs["ownershipSamples"]
        self.assertFalse((samples.ownershipClass == "3").any())

    def test_short_cross_class_parallel_overlap_is_allowed_at_handoff(self):
        reference = MultiLineString([[(0, 0), (100, 0)], [(45, 40), (55, 40)]])
        accepted, _, report = select(
            [LineString([(0, 0), (50, 0)]), LineString([(45, 40), (100, 40)])],
            reference, ["1", "2"], classPriority=["1", "2"],
            progressSampleMeters=5, maximumSampleDistanceMeters=35,
            crossClassParallelSearchMeters=50, crossClassParallelMinimumSamples=4)
        self.assertEqual(set(accepted.N13_003), {"1", "2"})
        self.assertEqual(report["crossClassParallelRejectedSampleCount"], 0)

    def test_cross_class_parallel_lookup_avoids_full_sample_cartesian_product(self):
        length = 10_000
        reference = MultiLineString([[(0, 0), (length, 0)], [(0, 40), (length, 40)]])
        _, _, report = select(
            [LineString([(0, 0), (length, 0)]), LineString([(0, 40), (length, 40)])],
            reference, ["1", "3"], classPriority=["1", "3"],
            maximumSampleDistanceMeters=35, crossClassParallelSearchMeters=50)
        samples_per_part = length // 5 + 1
        full_cross_part_product = 2 * samples_per_part * samples_per_part
        self.assertLess(report["crossClassParallelSampleComparisons"], full_cross_part_product / 50)
        self.assertLessEqual(report["crossClassParallelCandidatePairs"],
                             report["crossClassParallelSampleComparisons"])

    def test_short_unowned_source_feature_is_recovered_as_connector(self):
        lines = [LineString([(0, 0), (45, 0)]), LineString([(45, 0), (55, 0)]),
                 LineString([(55, 0), (100, 0)])]
        connected, report = self.connect(
            lines, LineString([(0, 0), (100, 0)]), ["1", "1", "1"],
            classPriority=["1"], progressSampleMeters=20, minimumOwnedReferenceSamples=2)
        connectors = connected[connected.selectionStatus == "accepted-continuity-connector"]
        self.assertEqual(set(connectors.sourceFeatureIndex), {1})
        self.assertEqual(report["continuityConnectorCount"], 1)
        self.assertEqual(report["ownershipGapCount"], 1)
        self.assertEqual(report["connectorGraphSearchCount"], 1)
        self.assertEqual(report["connectorCandidateEdgeCount"], 1)
        self.assertAlmostEqual(connected.geometry.union_all().length, 100)

    def test_intermediate_connector_keeps_both_curated_endpoints_unchanged(self):
        lines = [LineString([(0, 0), (45, 0)]), LineString([(45, 0), (55, 0)]),
                 LineString([(55, 0), (100, 0)])]
        reference = LineString([(0, 0), (100, 0)])
        settings = {"classPriority": ["1"], "progressSampleMeters": 20,
                    "minimumOwnedReferenceSamples": 2}
        curated, _, _ = select(lines, reference, ["1", "1", "1"], **settings)
        stage1 = gpd.GeoDataFrame({"N13_003": ["1"] * 3, "sourceFeatureIndex": range(3),
                                   "n13FeatureId": ["a", "b", "c"],
                                   "geometry": lines}, crs=MATCH_ROAD.METRIC_CRS)
        connected, _ = MATCH_ROAD.connect_adjacent_selected_runs(curated, stage1, reference, settings)
        self.assert_curated_rows_unchanged(curated, connected)
        self.assertLessEqual(curated.geometry.union_all().difference(
            connected.geometry.union_all()).length, 1e-9)

    def test_same_source_gap_adds_only_missing_interval_without_mutating_runs(self):
        parent = LineString([(0, 0), (30, 0)])
        curated = gpd.GeoDataFrame({
            "N13_003": ["1", "1"], "sourceFeatureIndex": [0, 0],
            "sourceAtomIndex": [0, 0], "n13FeatureId": ["a", "a"], "n13AtomId": ["a:0", "a:0"],
            "referencePart": [0, 0], "ownedReferenceStartMeters": [0., 20.],
            "ownedReferenceEndMeters": [10., 30.], "sourceStartDistanceMeters": [0., 20.],
            "sourceEndDistanceMeters": [10., 30.],
            "geometry": [MATCH_ROAD.substring(parent, 0, 10), MATCH_ROAD.substring(parent, 20, 30)]},
            crs=MATCH_ROAD.METRIC_CRS)
        stage1 = gpd.GeoDataFrame({"N13_003": ["1"], "sourceFeatureIndex": [0],
                                   "n13FeatureId": ["a"], "geometry": [parent]}, crs=MATCH_ROAD.METRIC_CRS)
        connected, _ = MATCH_ROAD.connect_adjacent_selected_runs(
            curated, stage1, parent, {"endpointSnapMeters": 2})
        self.assert_curated_rows_unchanged(curated, connected)
        connectors = connected[connected.selectionStatus == "accepted-continuity-connector"]
        self.assertEqual(len(connectors), 1)
        self.assertTrue(connectors.iloc[0].geometry.equals(LineString([(10, 0), (20, 0)])))

    def test_direct_junction_appends_extensions_without_mutating_curated_runs(self):
        parents = [LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)])]
        reference = LineString([(0, 0), (100, 0)])
        curated, _, _ = select(parents, reference, ["1", "1"], classPriority=["1"])
        ordered = curated.sort_values("ownedReferenceStartMeters").index
        curated.at[ordered[0], "geometry"] = MATCH_ROAD.substring(parents[0], 0, 45)
        curated.at[ordered[0], "sourceEndDistanceMeters"] = 45.
        curated.at[ordered[1], "geometry"] = MATCH_ROAD.substring(parents[1], 5, 50)
        curated.at[ordered[1], "sourceStartDistanceMeters"] = 5.
        stage1 = gpd.GeoDataFrame({"N13_003": ["1", "1"], "sourceFeatureIndex": [0, 1],
                                   "n13FeatureId": ["a", "b"],
                                   "geometry": parents}, crs=MATCH_ROAD.METRIC_CRS)
        connected, _ = MATCH_ROAD.connect_adjacent_selected_runs(curated, stage1, reference)
        self.assert_curated_rows_unchanged(curated, connected)
        self.assertAlmostEqual(connected.geometry.union_all().length, 100)

    def test_wrong_class_connector_is_not_reintroduced(self):
        lines = [LineString([(0, 0), (45, 0)]), LineString([(45, 0), (55, 0)]),
                 LineString([(55, 0), (100, 0)])]
        connected, report = self.connect(
            lines, LineString([(0, 0), (100, 0)]), ["1", "3", "1"],
            classPriority=["1", "3"], progressSampleMeters=20, minimumOwnedReferenceSamples=2)
        self.assertNotIn("accepted-continuity-connector", set(connected.selectionStatus))
        self.assertGreater(report["continuityUnresolvedGapCount"], 0)

    def test_direct_parent_junction_uses_no_graph_search(self):
        connected, report = self.connect(
            [LineString([(0, 0), (45, 0)]), LineString([(45, 0), (100, 0)])],
            LineString([(0, 0), (100, 0)]), ["1", "1"],
            classPriority=["1"], progressSampleMeters=20, minimumOwnedReferenceSamples=2)
        self.assertEqual(report["directSourceJunctionCount"], 1)
        self.assertEqual(report["connectorGraphSearchCount"], 0)
        self.assertAlmostEqual(connected.geometry.union_all().length, 100)

    def test_selected_run_exposes_required_provenance(self):
        accepted, diagnostics, _ = select([LineString([(0, 0), (100, 0)])],
                                          LineString([(0, 0), (100, 0)]), ["1"], classPriority=["1"])
        required = {"sourceFeatureIndex", "N13_003", "referencePart", "firstOwnedReferenceSample",
                    "lastOwnedReferenceSample", "ownedReferenceSampleCount", "sourceStartDistanceMeters",
                    "sourceEndDistanceMeters", "ownedReferenceStartMeters", "ownedReferenceEndMeters"}
        self.assertTrue(required.issubset(accepted.columns))
        self.assertEqual(len(diagnostics.attrs["ownershipSamples"]), 21)

    def test_connected_parents_restore_artificial_substring_gap(self):
        accepted, _, report = select([LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)])],
                                     LineString([(0, 0), (100, 0)]), ["1", "2"],
                                     classPriority=["1", "2"], endpointSnapMeters=2)
        first, second = accepted.sort_values("ownedReferenceStartMeters").geometry
        self.assertLessEqual(first.distance(second), 1e-9)
        self.assertGreaterEqual(report["junctionExtensionsApplied"], 1)

    def test_true_source_gap_is_not_invented(self):
        accepted, _, report = select([LineString([(0, 0), (48, 0)]), LineString([(54, 0), (100, 0)])],
                                     LineString([(0, 0), (100, 0)]), ["1", "2"],
                                     classPriority=["1", "2"], endpointSnapMeters=2)
        first, second = accepted.sort_values("ownedReferenceStartMeters").geometry
        self.assertAlmostEqual(first.distance(second), 6)
        self.assertGreaterEqual(report["sourceDisconnectedRunTransitions"], 1)

    def test_real_class_transition_uses_source_junction(self):
        accepted, _, _ = select([LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)])],
                                LineString([(0, 0), (100, 0)]), ["1", "2"],
                                classPriority=["1", "2"])
        self.assertEqual(set(accepted.N13_003), {"1", "2"})
        self.assertTrue(all(accepted.continuityValid))

    def test_disconnected_lower_class_interior_is_reassigned(self):
        lines = [LineString([(0, 0), (40, 0)]), LineString([(40, 2), (50, 2)]),
                 LineString([(50, 2), (60, 2)]), LineString([(60, 0), (100, 0)]),
                 LineString([(43, -1), (57, -1)])]
        accepted, ownership, _ = select(
            lines, LineString([(0, 0), (100, 0)]), ["1", "1", "1", "1", "3"],
            classPriority=["1", "3"], progressSampleMeters=2,
            minimumOwnedReferenceSamples=7, maximumSampleDistanceMeters=3,
            endpointSnapMeters=2)
        self.assertEqual(set(accepted.N13_003), {"1"})
        samples = ownership.attrs["ownershipSamples"]
        self.assertTrue(samples.reassignedFromSourceFeatureIndex.notna().any())

    def test_run_diagnostics_expose_source_connectivity(self):
        accepted, _, _ = select([LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)])],
                                LineString([(0, 0), (100, 0)]), ["1", "2"],
                                classPriority=["1", "2"])
        required = {"runPosition", "upstreamSourceConnected", "downstreamSourceConnected",
                    "continuityValid", "sourceRangeBeforeExtension", "sourceRangeAfterExtension",
                    "junctionExtensionMeters", "reassignedFromSourceFeatureIndex"}
        self.assertTrue(required.issubset(accepted.columns))

    def test_spatial_index_matches_brute_force_with_far_candidates(self):
        reference = LineString([(0, 0), (2000, 0)])
        nearby = [LineString([(start, 0), (start + 100, 0)]) for start in range(0, 2000, 100)]
        irrelevant = [LineString([(index * 4, 500), (index * 4 + 2, 510)]) for index in range(500)]
        lines = nearby + irrelevant
        classes = ["1"] * len(lines)
        indexed, _, indexed_report = select(
            lines, reference, classes, classPriority=["1"], useSpatialIndex=True)
        brute, _, brute_report = select(
            lines, reference, classes, classPriority=["1"], useSpatialIndex=False)
        self.assertEqual(set(indexed.sourceFeatureIndex), set(brute.sourceFeatureIndex))
        self.assertTrue(indexed.geometry.union_all().equals(brute.geometry.union_all()))
        full_product = indexed_report["referenceSampleCount"] * indexed_report["candidateEdgeCount"]
        self.assertLess(indexed_report["candidateComparisonsPerformed"], full_product / 20)
        self.assertEqual(brute_report["candidateComparisonsPerformed"], full_product)

    def _fixture(self, name):
        path = Path(__file__).parents[2] / "data/fixtures/road-matching" / name
        frame = gpd.read_file(path).to_crs(MATCH_ROAD.METRIC_CRS)
        reference = frame[frame["role"] == "osm-reference"].geometry.union_all()
        candidates = frame[frame["role"] == "n13-candidate"].copy()
        candidates["N13_003"] = candidates["N13_003"].astype(str)
        return candidates, reference

    def test_real_shinjuku_fixture_lower_classes_add_no_stems(self):
        candidates, reference = self._fixture("route20-shinjuku.geojson")
        class_one = candidates[candidates.N13_003 == "1"]
        one, _, _ = MATCH_ROAD.select_reference_network(class_one, reference, {"classPriority": ["1"]})
        all_classes, _, _ = MATCH_ROAD.select_reference_network(
            candidates, reference, {"classPriority": ["1", "2", "3"]})
        self.assertEqual(set(all_classes.N13_003), {"1"})
        self.assertAlmostEqual(all_classes.geometry.length.sum(), one.geometry.length.sum(), places=3)

    def test_western_fixture_lower_class_continues_unresolved_route(self):
        candidates, reference = self._fixture("route20-western.geojson")
        one, _, one_report = MATCH_ROAD.select_reference_network(
            candidates[candidates.N13_003 == "1"], reference, {"classPriority": ["1"]})
        all_classes, _, all_report = MATCH_ROAD.select_reference_network(
            candidates, reference, {"classPriority": ["1", "2", "3"]})
        self.assertLess(one_report["referencePartInference"][0]["matchedSampleCount"],
                        all_report["referencePartInference"][0]["matchedSampleCount"])
        self.assertEqual(set(all_classes.N13_003), {"1", "2"})


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
        self.assertIn('way["highway"]["ref"="20"]', query)
        self.assertNotIn('["network"=', query)

    @staticmethod
    def overpass_response(elements):
        response = MagicMock()
        response.__enter__.return_value = io.BytesIO(json.dumps({"elements": elements}).encode())
        return response

    def test_relation_members_are_preferred_and_reported(self):
        road = {"id": "tokyo-prefectural-430", "reference": {
            "type": "osm-ref", "ref": "430", "network": "JP:prefectural"}}
        member = {"type": "way", "id": 10, "tags": {"highway": "primary"},
                  "geometry": [{"lon": 139, "lat": 35}, {"lon": 140, "lat": 35}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(
                MATCH_ROAD, "urlopen", return_value=self.overpass_response([member])) as request:
            output = Path(directory) / "reference.geojson"
            acquisition = MATCH_ROAD.download_reference(road, output, "https://example.test", [1, 2, 3, 4])
            properties = json.loads(output.read_text())["features"][0]["properties"]
        self.assertEqual(acquisition, "exact-route-relation")
        self.assertEqual(request.call_count, 1)
        self.assertEqual(properties["osm_reference_network"], "JP:prefectural")
        self.assertEqual(properties["osm_reference_acquisition"], "exact-route-relation")

    def test_networkless_direct_ref_way_fallback_excludes_wrong_ref(self):
        road = {"id": "tokyo-prefectural-430", "reference": {
            "type": "osm-ref", "ref": "430", "network": "JP:prefectural"}}
        ways = [{"type": "way", "id": way_id, "tags": {"highway": "primary", "ref": ref},
                 "geometry": [{"lon": 139, "lat": lat}, {"lon": 140, "lat": lat}]}
                for way_id, ref, lat in ((10, "430", 35), (11, "431", 36))]
        responses = [self.overpass_response([]), self.overpass_response(ways)]
        with tempfile.TemporaryDirectory() as directory, patch.object(
                MATCH_ROAD, "urlopen", side_effect=responses) as request:
            output = Path(directory) / "reference.geojson"
            acquisition = MATCH_ROAD.download_reference(road, output, "https://example.test", [1, 2, 3, 4])
            document = json.loads(output.read_text())
        self.assertEqual(request.call_count, 2)
        self.assertEqual(acquisition, "direct-ref-way-fallback")
        self.assertEqual([feature["properties"]["osm_way_id"] for feature in document["features"]], [10])
        properties = document["features"][0]["properties"]
        self.assertEqual(properties["osm_reference_network"], "JP:prefectural")
        self.assertEqual(properties["osm_reference_acquisition"], "direct-ref-way-fallback")

    def test_fallback_provenance_retains_configured_network(self):
        road = {"id": "tokyo-prefectural-430", "reference": {
            "type": "osm-ref", "ref": "430", "network": "JP:prefectural"}}
        frame = gpd.GeoDataFrame({"ref": ["430"], "geometry": [
            LineString([(139, 35), (140, 35)])]}, crs="EPSG:4326")
        with tempfile.TemporaryDirectory() as directory, patch.object(
                MATCH_ROAD, "download_reference", return_value="direct-ref-way-fallback"), patch.object(
                MATCH_ROAD.gpd, "read_file", return_value=frame):
            config = {"osm": {"provider": "overpass", "cacheDirectory": directory,
                              "overpass": {"endpoint": "https://example.test"}}}
            _, provenance = MATCH_ROAD.build_osm_reference(
                road, config, [138, 34, 141, 36], refresh=True)
        self.assertEqual(provenance["referenceAcquisition"], "direct-ref-way-fallback")
        self.assertEqual(provenance["referenceNetwork"], "JP:prefectural")
        self.assertEqual(provenance["referenceRef"], "430")

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

    def test_exact_member_name_exclusions_split_only_matching_physical_ways(self):
        frame = gpd.GeoDataFrame({
            "osm_way_id": ["A", "B", "C", "D", "E"],
            "name": ["甲州街道", "八王子南バイパス", "国道20号", None,
                     "別名; 八王子南バイパス"],
            "geometry": [LineString([(0, y), (10, y)]) for y in range(5)],
        }, crs=MATCH_ROAD.METRIC_CRS)
        entity = {"reference": {"type": "osm-ref", "ref": "20", "network": "JP:national",
                                "excludeNames": ["八王子南バイパス"]}}
        included, excluded = MATCH_ROAD.filter_reference_members(entity, frame)
        self.assertEqual(list(included.osm_way_id), ["A", "C", "D"])
        self.assertEqual(list(excluded.osm_way_id), ["B", "E"])

        partial = {**entity, "reference": {**entity["reference"], "excludeNames": ["八王子南"]}}
        included, excluded = MATCH_ROAD.filter_reference_members(partial, frame)
        self.assertEqual(len(included), 5)
        self.assertTrue(excluded.empty)

        empty = {**entity, "reference": {**entity["reference"], "excludeNames": []}}
        included, excluded = MATCH_ROAD.filter_reference_members(empty, frame)
        self.assertEqual(len(included), 5)
        self.assertTrue(excluded.empty)

    def test_exclusions_filter_matcher_geometry_but_not_raw_cache_identity(self):
        frame = gpd.GeoDataFrame({"ref": ["20", "20"],
                                  "name": ["甲州街道", "八王子南バイパス"],
                                  "geometry": [LineString([(0, 0), (10, 0)]),
                                               LineString([(0, 100), (10, 100)])]},
                                 crs=MATCH_ROAD.METRIC_CRS)
        reference = {"type": "osm-ref", "ref": "20", "network": "JP:national",
                     "excludeNames": ["八王子南バイパス"]}
        geometry, report = MATCH_ROAD.build_reference({"id": "route-20", "reference": reference}, frame)
        self.assertEqual(geometry.bounds, (0.0, 0.0, 10.0, 0.0))
        self.assertEqual(report["memberWayCount"], 2)
        self.assertEqual(report["excludedByExactNameCount"], 1)
        self.assertEqual(MATCH_ROAD.reference_cache_identity(reference),
                         {"type": "osm-ref", "ref": "20", "network": "JP:national"})

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


class StableIdentityAndManualSelectionTests(unittest.TestCase):
    def match_result(self, automatic_ids):
        diagnostics = gpd.GeoDataFrame({
            "n13FeatureId":["a","b"], "n13AtomId":["a:0","b:0"],
            "sourceFeatureIndex":[0,1], "sourceAtomIndex":[0,0], "N13_003":["1","1"],
            "match_min_m":[0.,0.], "match_median_m":[0.,0.], "match_p90_m":[0.,0.],
            "geometry":[LineString([(0,0),(10,0)]),LineString([(20,0),(30,0)])],
        }, crs=MATCH_ROAD.METRIC_CRS)
        selected = diagnostics[diagnostics.n13AtomId.isin(automatic_ids)].copy()
        selected["referencePart"] = 0
        selected["ownedReferenceStartMeters"] = [0. if atom == "a:0" else 20. for atom in selected.n13AtomId]
        selected["ownedReferenceEndMeters"] = [10. if atom == "a:0" else 30. for atom in selected.n13AtomId]
        selected["sourceStartDistanceMeters"] = 0.
        selected["sourceEndDistanceMeters"] = 10.
        return {"selected":selected, "selectionDiagnostics":diagnostics,
            "residualPass":diagnostics, "reference":LineString([(0,0),(30,0)]),
            "road":{"n13":{"classifications":["1"]}, "networkSelection":{},
                    "matching":{"sampleIntervalMeters":5,"coverageToleranceMeters":5}},
            "displayConfig":{"endpointSnapMeters":2}, "networkReport":{}}

    def same_atom_substring_result(self):
        diagnostics = gpd.GeoDataFrame({
            "n13FeatureId":["a","b"], "n13AtomId":["a:0","b:0"],
            "sourceFeatureIndex":[0,1], "sourceAtomIndex":[0,0], "N13_003":["1","1"],
            "match_min_m":[0.,0.], "match_median_m":[0.,0.], "match_p90_m":[0.,0.],
            "geometry":[LineString([(0,0),(30,0)]),LineString([(40,0),(50,0)])],
        }, crs=MATCH_ROAD.METRIC_CRS)
        selected = gpd.GeoDataFrame({
            **{column:[diagnostics.iloc[0][column],diagnostics.iloc[0][column]]
               for column in diagnostics.columns if column != "geometry"},
            "geometry":[LineString([(0,0),(10,0)]),LineString([(20,0),(30,0)])],
        }, crs=MATCH_ROAD.METRIC_CRS)
        selected["referencePart"] = 0
        selected["ownedReferenceStartMeters"] = [0.,20.]
        selected["ownedReferenceEndMeters"] = [10.,30.]
        selected["sourceStartDistanceMeters"] = [0.,20.]
        selected["sourceEndDistanceMeters"] = [10.,30.]
        return {"selected":selected, "selectionDiagnostics":diagnostics,
            "residualPass":diagnostics, "reference":LineString([(0,0),(50,0)]),
            "road":{"n13":{"classifications":["1"]}, "networkSelection":{},
                    "matching":{"sampleIntervalMeters":5,"coverageToleranceMeters":5}},
            "displayConfig":{"endpointSnapMeters":2}, "networkReport":{}}

    def test_stable_ids_ignore_dataframe_order_and_change_with_geometry(self):
        frame = gpd.GeoDataFrame({"N13_001":["source-a","source-b"],"N13_003":["1","1"],
            "geometry":[LineString([(0,0),(10,0)]),LineString([(10,0),(20,0)])]}, crs=MATCH_ROAD.METRIC_CRS)
        first = MATCH_ROAD.add_stable_n13_ids(frame)
        reordered = MATCH_ROAD.add_stable_n13_ids(frame.iloc[::-1].reset_index(drop=True))
        self.assertEqual(set(first.n13FeatureId), set(reordered.n13FeatureId))
        unchanged = MATCH_ROAD.add_stable_n13_ids(frame.copy())
        self.assertEqual(list(first.n13AtomId), list(unchanged.n13AtomId))
        changed = frame.copy(); changed.at[0,"geometry"] = LineString([(0,0),(11,0)])
        self.assertNotEqual(first.at[0,"n13FeatureId"], MATCH_ROAD.add_stable_n13_ids(changed).at[0,"n13FeatureId"])

    def test_multipart_atoms_receive_distinct_ids(self):
        geometry = MultiLineString([[(0,0),(5,0)],[(5,0),(10,0)]])
        frame = MATCH_ROAD.add_stable_n13_ids(gpd.GeoDataFrame({"N13_003":["1"],"geometry":[geometry]}, crs=MATCH_ROAD.METRIC_CRS))
        exploded = frame.explode(index_parts=True).reset_index(drop=True)
        exploded["sourceAtomIndex"] = range(len(exploded))
        exploded["n13AtomId"] = [f"{feature}:{atom}" for feature,atom in zip(exploded.n13FeatureId,exploded.sourceAtomIndex)]
        self.assertEqual(len(set(exploded.n13AtomId)), 2)

    def test_manual_selection_is_explicit_and_reversible(self):
        diagnostics = gpd.GeoDataFrame({"n13FeatureId":["a","b"],"n13AtomId":["a:0","b:0"],
            "sourceFeatureIndex":[0,1],"sourceAtomIndex":[0,0],"N13_003":["1","1"],
            "geometry":[LineString([(0,0),(10,0)]),LineString([(10,0),(20,0)])]}, crs=MATCH_ROAD.METRIC_CRS)
        selected = diagnostics.iloc[[0]].copy()
        selected["referencePart"] = 0; selected["ownedReferenceStartMeters"] = 0.; selected["ownedReferenceEndMeters"] = 10.
        selected["sourceStartDistanceMeters"] = 0.; selected["sourceEndDistanceMeters"] = 10.
        result = {"selected":selected,"selectionDiagnostics":diagnostics,"reference":LineString([(0,0),(20,0)])}
        curated = MATCH_ROAD.curate_selection(result,{"exclude":["a:0"],"include":["b:0"]})
        self.assertEqual(set(curated.n13AtomId), {"b:0"})
        self.assertEqual(curated.iloc[0].selectionReason, "accepted-manual")
        self.assertEqual(set(MATCH_ROAD.curate_selection(result,{}).n13AtomId), {"a:0"})

    def test_automatic_partial_atom_none_restores_exact_baseline_substrings(self):
        result = self.same_atom_substring_result()
        baseline = result["selected"]
        curated = MATCH_ROAD.curate_selection(result, {})
        self.assertEqual([geometry.wkb for geometry in curated.geometry],
                         [geometry.wkb for geometry in baseline.geometry])

    def test_automatic_partial_atom_exclude_removes_all_substrings(self):
        curated = MATCH_ROAD.curate_selection(
            self.same_atom_substring_result(), {"include": [], "exclude": ["a:0"]})
        self.assertNotIn("a:0", set(curated.n13AtomId))

    def test_automatic_partial_atom_include_promotes_to_one_complete_source_atom(self):
        result = self.same_atom_substring_result()
        curated = MATCH_ROAD.curate_selection(result, {"include": ["a:0"], "exclude": []})
        promoted = curated[curated.n13AtomId == "a:0"]
        self.assertEqual(len(promoted), 1)
        self.assertEqual(promoted.iloc[0].geometry.wkb, result["selectionDiagnostics"].iloc[0].geometry.wkb)
        self.assertEqual(promoted.iloc[0].manualSelection, "include")

    def test_removing_automatic_include_restores_exact_partial_baseline(self):
        result = self.same_atom_substring_result()
        MATCH_ROAD.curate_selection(result, {"include": ["a:0"], "exclude": []})
        restored = MATCH_ROAD.curate_selection(result, {"include": [], "exclude": []})
        self.assertEqual([geometry.wkb for geometry in restored.geometry],
                         [geometry.wkb for geometry in result["selected"].geometry])

    def test_removing_nonautomatic_include_returns_atom_to_unselected(self):
        result = self.same_atom_substring_result()
        included = MATCH_ROAD.curate_selection(result, {"include": ["b:0"], "exclude": []})
        self.assertIn("b:0", set(included.n13AtomId))
        restored = MATCH_ROAD.curate_selection(result, {"include": [], "exclude": []})
        self.assertNotIn("b:0", set(restored.n13AtomId))

    def test_removing_nonautomatic_exclude_does_not_include_atom(self):
        result = self.same_atom_substring_result()
        excluded = MATCH_ROAD.curate_selection(result, {"include": [], "exclude": ["b:0"]})
        self.assertNotIn("b:0", set(excluded.n13AtomId))
        restored = MATCH_ROAD.curate_selection(result, {"include": [], "exclude": []})
        self.assertNotIn("b:0", set(restored.n13AtomId))

    def test_connect_match_preview_preserves_manual_include_in_curated_and_final_selection(self):
        connected = MATCH_ROAD.connect_match_preview(
            self.match_result(["a:0"]), {"include":["b:0"],"exclude":[]})
        self.assertEqual(set(connected["curatedSelected"].n13AtomId), {"a:0","b:0"})
        self.assertEqual(set(connected["selected"].n13AtomId), {"a:0","b:0"})
        self.assertEqual(connected["networkReport"]["automaticSelectedAtomCount"], 1)
        self.assertEqual(connected["networkReport"]["manualIncludedAtomCount"], 1)
        self.assertEqual(connected["networkReport"]["manualExcludedAtomCount"], 0)
        self.assertEqual(connected["networkReport"]["curatedSelectedAtomCount"], 2)
        self.assertEqual(connected["networkReport"]["finalSelectedAtomCount"], 2)
        self.assertEqual(connected["connectDiagnostics"]["curatedManualIncludedAtomIds"], ["b:0"])
        self.assertEqual(connected["connectDiagnostics"]["finalManualIncludedAtomIds"], ["b:0"])

    def test_connect_match_preview_does_not_restore_manual_exclusion_as_connector(self):
        connected = MATCH_ROAD.connect_match_preview(
            self.match_result(["a:0","b:0"]), {"include":[],"exclude":["b:0"]})
        self.assertEqual(set(connected["curatedSelected"].n13AtomId), {"a:0"})
        self.assertEqual(set(connected["selected"].n13AtomId), {"a:0"})

    def test_connect_match_preview_raises_if_topology_discards_a_curated_atom(self):
        result = self.match_result(["a:0"])
        with patch.object(MATCH_ROAD, "connect_adjacent_selected_runs",
                          side_effect=lambda curated, *_args, **_kwargs: (curated.iloc[[0]].copy(), {})):
            with self.assertRaisesRegex(RuntimeError, "discarded curated N13 atoms: b:0"):
                MATCH_ROAD.connect_match_preview(result, {"include":["b:0"],"exclude":[]})

    def test_same_atom_multiple_substrings_are_geometrically_preserved_or_merged(self):
        connected = MATCH_ROAD.connect_match_preview(self.same_atom_substring_result())
        curated_union = connected["curatedSelected"].geometry.union_all()
        final_union = connected["selected"].geometry.union_all()
        self.assertLessEqual(curated_union.difference(final_union).length, 1e-6)
        self.assertEqual(connected["connectDiagnostics"]["lostCuratedGeometryLengthMeters"], 0)

    def test_geometry_invariant_detects_lost_same_atom_substring(self):
        result = self.same_atom_substring_result()
        with patch.object(MATCH_ROAD, "connect_adjacent_selected_runs",
                          side_effect=lambda curated, *_args, **_kwargs: (curated.iloc[[0]].copy(), {})):
            with self.assertRaisesRegex(RuntimeError, "removed 10.000000 m.*atoms: a:0"):
                MATCH_ROAD.connect_match_preview(result)

    def test_final_geometry_contains_auto_substrings_and_manual_full_atom(self):
        connected = MATCH_ROAD.connect_match_preview(
            self.same_atom_substring_result(), {"include":["b:0"],"exclude":[]})
        visible_before = connected["curatedSelected"].geometry.union_all()
        final_geometry = connected["selected"].geometry.union_all()
        self.assertLessEqual(visible_before.difference(final_geometry).length, 1e-6)
        self.assertEqual(set(connected["selected"].n13AtomId), {"a:0","b:0"})


if __name__ == "__main__":
    unittest.main()
