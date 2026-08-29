"""Offline fixture tests for reusable OSM rail normalization."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from rail_source import normalize, run


def feature(fid, railway, geometry, **properties):
    kind, oid = fid.split("/")
    return {"type": "Feature", "id": fid, "properties": {"railway": railway, "osm_element_type": kind, "osm_element_id": int(oid), **properties}, "geometry": geometry}


class RailSourceTests(unittest.TestCase):
    def setUp(self):
        self.features = [
            feature("way/1", "rail", {"type":"LineString", "coordinates":[[139,35],[140,35]]}, name="Main", operator="JR", service="main"),
            feature("way/2", "subway", {"type":"LineString", "coordinates":[[139,35.001],[140,35.001]]}, network="Metro"),
            feature("way/3", "construction", {"type":"LineString", "coordinates":[[0,0],[1,1]]}),
            feature("node/4", "station", {"type":"Point", "coordinates":[139.5,35.5]}, name="Node Station"),
            feature("way/5", "station", {"type":"Polygon", "coordinates":[[[139,35],[139.2,35],[139.2,35.2],[139,35.2],[139,35]]]}, name="Area Station"),
            feature("node/4", "station", {"type":"Point", "coordinates":[139.5,35.5]}, name="Node Station"),
        ]

    def test_selection_properties_points_duplicates_and_parallel_tracks(self):
        tracks, stations = normalize(self.features)
        self.assertEqual([t["properties"]["railway"] for t in tracks], ["rail", "subway"])
        self.assertEqual(len(tracks), 2)  # parallel source ways are never collapsed
        self.assertEqual(tracks[0]["properties"]["operator"], "JR")
        self.assertEqual(tracks[0]["properties"]["osm_way_id"], 1)
        self.assertEqual(len(stations), 2)
        self.assertEqual(stations[0]["geometry"]["coordinates"], [139.5, 35.5])
        self.assertEqual(stations[1]["properties"]["sourceGeometryType"], "Polygon")
        self.assertAlmostEqual(stations[1]["geometry"]["coordinates"][0], 139.1)

    def test_manifest_counts_categories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "rail.geojson"
            source.write_text(json.dumps({"type":"FeatureCollection", "features":self.features}))
            manifest = run(source, root / "cache", configured_bounds=[138.9,35.45,140,35.95], extension=".geojson")
            self.assertEqual(manifest["featureCounts"], {"tracks":2, "stations":2})
            self.assertEqual(manifest["trackCountsByRailway"], {"rail":1, "subway":1})
            self.assertEqual(manifest["workingBoundsWgs84"], [138.9,35.45,140,35.95])
            self.assertTrue((root / "cache/index.json").exists())


if __name__ == "__main__": unittest.main()
