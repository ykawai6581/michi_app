"""Synthetic regression tests for N13 display-geometry stitching."""

import importlib.util
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
