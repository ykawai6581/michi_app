"""Synthetic regression tests for N13 display-geometry stitching."""

import importlib.util
import json
import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, MultiLineString


SPEC = importlib.util.spec_from_file_location("match_road", Path(__file__).with_name("match-road.py"))
MATCH_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATCH_ROAD)


def route_20_fixture():
    return {
        "id": "jp-national-20", "displayName": "国道20号", "aliases": [],
        "entityType": "statutory-road", "jurisdiction": "JP",
        "n13": {"classifications": ["1", "2", "3"]},
        "matching": {"sampleIntervalMeters": 5, "maximumMedianResidualMeters": 20,
                     "maximumP90ResidualMeters": 25, "coverageToleranceMeters": 25},
        "reference": {"type": "osm-ref", "ref": "20", "network": "JP:national"},
    }


def koshu_named_fixture():
    return {
        "id": "tokyo-named-koshu-kaido", "displayName": "甲州街道", "aliases": [],
        "entityType": "named-road", "jurisdiction": "Tokyo",
        "n13": {"classifications": ["2", "3"]},
        "matching": {"sampleIntervalMeters": 5, "maximumMedianResidualMeters": 20,
                     "maximumP90ResidualMeters": 25, "coverageToleranceMeters": 25},
        "reference": {"type": "osm-name", "names": ["甲州街道"], "tags": ["name"]},
    }


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


def hierarchical(lines, classes, reference, priority, **settings):
    frame = gpd.GeoDataFrame({
        "N13_003": classes,
        "match_min_m": [line.distance(reference) for line in lines],
        "match_median_m": [line.distance(reference) for line in lines],
        "match_p90_m": [line.distance(reference) for line in lines],
        "geometry": lines,
    }, crs=MATCH_ROAD.METRIC_CRS)
    return MATCH_ROAD.select_reference_network_hierarchical(frame, reference, priority, settings)


def prune(lines, reference, **settings):
    frame = gpd.GeoDataFrame({
        "selectionStatus": ["accepted-backbone"] * len(lines),
        "selectionReason": ["accepted-backbone"] * len(lines),
        "geometry": lines,
    }, crs=MATCH_ROAD.METRIC_CRS)
    return MATCH_ROAD.prune_selected_branches(frame, reference, settings)


class BranchPruningTests(unittest.TestCase):
    def test_network_output_can_join_rejections_without_duplicate_index_columns(self):
        reference = LineString([(0, 0), (100, 0)])
        lines = [LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
                 LineString([(50, 0), (55, 8), (58, 20)])]
        stage1 = gpd.GeoDataFrame({
            "N13_003": ["2"] * 3,
            "match_min_m": [line.distance(reference) for line in lines],
            "match_median_m": [line.distance(reference) for line in lines],
            "match_p90_m": [line.distance(reference) for line in lines],
            "geometry": lines,
        }, crs=MATCH_ROAD.METRIC_CRS)
        network, diagnostics, _ = MATCH_ROAD.select_reference_network(stage1, reference)
        # Model a post-selection spur, while retaining the exact selector schema
        # that previously triggered "Reindexing only valid with uniquely valued Index objects".
        selected = pd.concat([network, stage1.iloc[[2]].assign(
            sourceFeatureIndex=2, selectionStatus="accepted-gap-repair",
            selectionReason="accepted-gap-repair")], ignore_index=True)
        retained, rejected, _ = MATCH_ROAD.prune_selected_branches(
            gpd.GeoDataFrame(selected, crs=stage1.crs), reference)
        combined = pd.concat([diagnostics, rejected], ignore_index=True)
        self.assertTrue(combined.columns.is_unique)
        self.assertEqual(set(retained.sourceFeatureIndex), {0, 1})

    def test_case_a_dangling_spur_is_removed_after_selection(self):
        lines = [LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
                 LineString([(50, 0), (55, 8), (58, 20)])]
        retained, rejected, report = prune(lines, LineString([(0, 0), (100, 0)]))
        self.assertEqual(set(retained.sourceFeatureIndex), {0, 1})
        self.assertEqual(set(rejected.rejectionReason), {"dangling-spur"})
        self.assertEqual(report["rejectedBranches"], 1)

    def test_case_b_short_divided_carriageways_are_both_retained(self):
        lines = [LineString([(0, 0), (30, 0)]), LineString([(30, 0), (70, 0)]),
                 LineString([(30, 0), (50, 3), (70, 0)]), LineString([(70, 0), (100, 0)])]
        retained, rejected, report = prune(lines, LineString([(0, 0), (100, 0)]))
        self.assertEqual(len(retained), 4)
        self.assertTrue(rejected.empty)
        self.assertGreaterEqual(report["retainedAlternativePaths"], 2)

    def test_case_c_rejoining_slip_loop_with_excessive_detour_is_removed(self):
        lines = [LineString([(0, 0), (30, 0)]), LineString([(30, 0), (70, 0)]),
                 LineString([(30, 0), (34, 18), (66, 18), (70, 0)]), LineString([(70, 0), (100, 0)])]
        retained, rejected, _ = prune(lines, LineString([(0, 0), (100, 0)]), maximumResidualMeters=30)
        self.assertEqual(set(retained.sourceFeatureIndex), {0, 1, 3})
        self.assertEqual(set(rejected.rejectionReason), {"excessive-detour"})

    def test_case_d_non_reconverging_forward_fork_is_not_aggressively_pruned(self):
        reference = MultiLineString([[(0, 0), (100, 0)], [(50, 0), (100, 20)]])
        lines = [LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
                 LineString([(50, 0), (100, 20)])]
        retained, rejected, _ = prune(lines, reference)
        self.assertEqual(len(retained), 3)
        self.assertTrue(rejected.empty)

    def test_case_e_unique_reference_coverage_protects_necessary_branch(self):
        lines = [LineString([(0, 0), (40, 0)]), LineString([(40, 0), (70, 0)]),
                 LineString([(40, 0), (65, 13), (100, 20)])]
        retained, rejected, report = prune(lines, LineString([(0, 0), (100, 0)]), maximumResidualMeters=10)
        self.assertEqual(len(retained), 3)
        self.assertTrue(rejected.empty)
        self.assertGreaterEqual(report["protectedUniqueCoverageBranches"], 1)

    def test_case_f_very_close_parallel_carriageways_are_not_collapsed(self):
        lines = [LineString([(0, 0), (25, 0)]), LineString([(25, 0), (75, 0)]),
                 LineString([(25, 0), (75, 1)]), LineString([(75, 0), (100, 0)])]
        retained, rejected, _ = prune(lines, LineString([(0, 0), (100, 0)]), endpointSnapMeters=2)
        self.assertEqual(len(retained), 4)
        self.assertTrue(rejected.empty)

    def test_shallow_corridor_spur_passes_residual_but_topology_rejects_it(self):
        reference = LineString([(0, 0), (120, 0)])
        lines = [LineString([(0, 0), (60, 0)]), LineString([(60, 0), (120, 0)]),
                 LineString([(60, 0), (68, 3), (75, 10), (80, 20)])]
        road = {"matching": {"sampleIntervalMeters": 5, "maximumMedianResidualMeters": 25,
                             "maximumP90ResidualMeters": 30}}
        candidates = gpd.GeoDataFrame({"geometry": lines}, crs=MATCH_ROAD.METRIC_CRS)
        residual_pass, _ = MATCH_ROAD.match_n13(candidates, reference, road)
        self.assertEqual(len(residual_pass), 3)
        residual_pass["selectionStatus"] = "accepted-backbone"
        residual_pass["selectionReason"] = "accepted-backbone"
        retained, rejected, _ = MATCH_ROAD.prune_selected_branches(residual_pass, reference)
        self.assertEqual(len(retained), 2)
        self.assertEqual(rejected.iloc[0].rejectionReason, "dangling-spur")

    def test_moderate_residual_shallow_stem_is_rejected_without_residual_growth(self):
        reference = LineString([(0, 0), (150, 0)])
        retained, rejected, _ = prune([
            LineString([(0, 0), (60, 0)]), LineString([(60, 0), (150, 0)]),
            LineString([(60, 0), (70, 5), (120, 5)])], reference)
        self.assertEqual(set(retained.sourceFeatureIndex), {0, 1})
        self.assertEqual(rejected.iloc[0].rejectionReason, "dangling-spur")


class NetworkSelectionTests(unittest.TestCase):
    def test_hierarchical_a_shinjuku_parallel_stem_is_outside_fallback_domain(self):
        reference = LineString([(0, 0), (300, 0)])
        accepted, diagnostic, report = hierarchical(
            [LineString([(0, 0), (300, 0)]), LineString([(80, 10), (230, 10)])],
            ["1", "2"], reference, ["1", "2"])
        self.assertEqual(set(accepted.N13_003), {"1"})
        fallback = diagnostic[diagnostic.N13_003 == "2"].iloc[0]
        self.assertEqual(fallback.rejectionReason, "higher-class-reference-already-resolved")
        self.assertTrue(report["referenceRuns"][0]["locked"])

    def test_hierarchical_b_western_fallback_fills_unresolved_reference(self):
        accepted, _, report = hierarchical(
            [LineString([(0, 0), (180, 0)]), LineString([(170, 0), (400, 0)])],
            ["1", "2"], LineString([(0, 0), (400, 0)]), ["1", "2"])
        self.assertEqual(set(accepted.N13_003), {"1", "2"})
        self.assertEqual(set(accepted.selectionClassPass), {"1", "2"})
        self.assertGreater(sum(item["selectedReferenceSampleCount"] for _, item in accepted.iterrows()), 0)
        self.assertEqual(report["mode"], "hierarchical-reference-coverage")

    def test_hierarchical_c_tiny_high_class_island_does_not_lock_fallback(self):
        accepted, _, report = hierarchical(
            [LineString([(190, 0), (210, 0)]), LineString([(0, 0), (400, 0)])],
            ["1", "2"], LineString([(0, 0), (400, 0)]), ["1", "2"])
        self.assertIn("2", set(accepted.N13_003))
        class_one_runs = [run for run in report["referenceRuns"] if run["resolvedByClass"] == "1"]
        self.assertTrue(class_one_runs)
        self.assertTrue(all(not run["locked"] for run in class_one_runs))

    def test_hierarchical_d_real_high_class_gap_is_filled_by_fallback(self):
        accepted, _, _ = hierarchical(
            [LineString([(0, 0), (150, 0)]), LineString([(200, 0), (400, 0)]),
             LineString([(140, 0), (210, 0)])], ["1", "1", "2"],
            LineString([(0, 0), (400, 0)]), ["1", "2"])
        self.assertEqual(set(accepted.N13_003), {"1", "2"})

    def test_hierarchical_e_lower_class_cannot_traverse_locked_interior(self):
        accepted, diagnostic, _ = hierarchical(
            [LineString([(0, 0), (250, 0)]), LineString([(20, 8), (250, 8)]),
             LineString([(250, 0), (500, 0)])], ["1", "2", "2"],
            LineString([(0, 0), (500, 0)]), ["1", "2"])
        self.assertEqual(set(accepted.sourceFeatureIndex), {0, 2})
        blocked = diagnostic[diagnostic.sourceFeatureIndex == 1].iloc[0]
        self.assertEqual(blocked.rejectionReason, "higher-class-reference-already-resolved")

    def test_hierarchical_f_multipart_reference_is_resolved_independently(self):
        reference = MultiLineString([[(0, 0), (200, 0)], [(0, 5), (200, 5)]])
        accepted, _, report = hierarchical(
            [LineString([(0, 0), (200, 0)]), LineString([(0, 5), (200, 5)])],
            ["1", "2"], reference, ["1", "2"])
        self.assertEqual(set(accepted.N13_003), {"1", "2"})
        self.assertEqual({run["referencePart"] for run in report["referenceRuns"] if run["locked"]}, {0, 1})

    def test_straight_road_rejects_short_t_spur(self):
        accepted, diagnostic, _ = select([
            LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
            LineString([(50, 0), (50, 20)])], LineString([(0, 0), (100, 0)]))
        self.assertEqual(len(accepted), 2)
        self.assertEqual(diagnostic.iloc[2].selectionStatus, "rejected-spur")

    def test_t_spur_two_adjacent_edges_are_one_physical_attachment(self):
        accepted, diagnostic, _ = select([
            LineString([(0, 0), (50, 0)]), LineString([(50, 0), (100, 0)]),
            LineString([(50, 0), (50, 20)])], LineString([(0, 0), (100, 0)]))
        spur = diagnostic.iloc[2]
        self.assertEqual(spur.gapRepairAdjacentEdgeCount, 2)
        self.assertEqual(spur.gapRepairAttachmentJunctionCount, 1)
        self.assertFalse(spur.gapRepairMembership)
        self.assertNotIn(2, set(accepted.sourceFeatureIndex))

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
        if not report_path.exists():
            self.skipTest("generated Route 20 report is not available")
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
            road = route_20_fixture()
            config = {"osm": {"provider": "overpass", "cacheDirectory": str(cache),
                              "overpass": {"endpoint": "https://example.test"}}}
            with patch.object(MATCH_ROAD, "download_reference") as download, patch.object(
                    MATCH_ROAD.gpd, "read_file", return_value=gpd.GeoDataFrame(
                        {"ref": ["20"], "geometry": [LineString([(139, 35), (140, 35)])]}, crs="EPSG:4326")):
                MATCH_ROAD.build_osm_reference(road, config, [139, 35, 140, 35.1])
            download.assert_called_once()

    def test_provider_uses_configured_statutory_identity_and_bounds(self):
        road = {**route_20_fixture(), "id": "tokyo-prefectural-318",
                "reference": {"type": "osm-ref", "ref": "318", "network": "JP:prefectural"}}
        with tempfile.TemporaryDirectory() as directory:
            config = {"osm": {"provider": "overpass", "cacheDirectory": directory, "overpass": {
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
        with tempfile.TemporaryDirectory() as directory:
            config = {"osm": {"provider": "overpass", "cacheDirectory": directory, "overpass": {
                "endpoint": "https://example.test", "boundsByJurisdiction": {"JP": [122, 20, 154, 46]}}}}
            for road_id in ("jp-national-20", "tokyo-named-koshu-kaido"):
                road = route_20_fixture() if road_id == "jp-national-20" else koshu_named_fixture()
                with patch.object(MATCH_ROAD, "download_reference") as download, patch.object(
                        MATCH_ROAD.gpd, "read_file", return_value=gpd.GeoDataFrame(
                            {"ref": ["20"], "name": ["甲州街道"], "geometry": [LineString([(139.5, 35.6), (139.7, 35.6)])]},
                            crs="EPSG:4326")):
                    MATCH_ROAD.build_osm_reference(road, config, bounds, refresh=True)
                self.assertEqual(download.call_args.args[3], bounds)
        query = MATCH_ROAD.osm_query(
            koshu_named_fixture(), bounds)
        self.assertIn('["name"="甲州街道"](35.5,139.5,35.8,139.8)', query)
        self.assertNotIn("(20,122,46,154)", query)

    def test_load_road_uses_supplied_registry_without_local_state(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "registry.json"
            registry.write_text(json.dumps({"roads": [route_20_fixture()]}))
            self.assertEqual(MATCH_ROAD.load_road(registry, "jp-national-20")["id"], "jp-national-20")

    def test_statutory_reference_query_uses_one_ref(self):
        road = route_20_fixture()
        query = MATCH_ROAD.osm_query(road, [1, 2, 3, 4])
        self.assertIn('["ref"="20"]', query)
        self.assertNotIn("甲州街道", query)

    def test_networked_statutory_query_uses_only_exact_relation_members(self):
        road = route_20_fixture()
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
        road = route_20_fixture()
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
        road = route_20_fixture()
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
        road = {**koshu_named_fixture(), "id": "tokyo-named-inokashira-dori",
                "reference": {"type": "osm-name", "names": ["井ノ頭通り", "井の頭通り"],
                              "tags": ["name", "name:ja", "alt_name"]}}
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
            reference = gpd.GeoSeries(
                [LineString([(139, 35), (139.02, 35)])], crs="EPSG:4326").to_crs(MATCH_ROAD.METRIC_CRS).iloc[0]
            candidates = MATCH_ROAD.load_n13_candidates(entity, root, reference)
            selected, _ = MATCH_ROAD.match_n13(candidates, reference, entity)
            self.assertEqual(set(selected.N13_003), {"2", "3"})
            self.assertEqual(len(selected), 2)
            self.assertEqual(candidates.attrs["classDiagnostics"]["2"]["partitionFeatureCount"], 2)
            self.assertEqual(candidates.attrs["classDiagnostics"]["2"]["spatiallyShortlistedCount"], 1)
            self.assertEqual(candidates.attrs["classDiagnostics"]["3"]["residualTestedCount"], 1)

    def test_local_osm_reference_is_clipped_to_n13_bounds(self):
        road = koshu_named_fixture()
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
