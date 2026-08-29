"""Offline fixture tests for CODH road/post normalization and linkage."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from codh_source import normalize_posts, normalize_roads, run


def road(rid, name, y=35):
    return {"type":"Feature", "id":f"road-{rid}", "properties":{"route_id":rid,"road_name":name,"extra":"kept"}, "geometry":{"type":"LineString","coordinates":[[139,y],[140,y+0.1]]}}


class CodhSourceTests(unittest.TestCase):
    def setUp(self):
        self.roads = [road(f"R00{i}", name, 34+i/10) for i,name in enumerate(["東海道","中山道","甲州道中","奥州道中","日光道中"], 1)] + [road("R006", "追加街道")]
        self.posts = [
            {"type":"Feature","id":"P1","properties":{"road_id":"R003","name":"同名でなくても連結","note":"kept"},"geometry":{"type":"Point","coordinates":[139.1,35.1]}},
            {"type":"Feature","id":"P2","properties":{"road_id":"R003","name":"第二宿"},"geometry":{"type":"Point","coordinates":[139.2,35.2]}},
        ]

    def test_routes_geometry_additional_roads_and_posts(self):
        normalized = normalize_roads(self.roads, "EPSG:4326")
        self.assertEqual({f["properties"]["routeId"] for f in normalized}, {f"R00{i}" for i in range(1,7)})
        self.assertEqual(normalized[0]["geometry"], self.roads[0]["geometry"])
        for rid in ["R001","R002","R003","R004","R005"]:
            self.assertEqual(len([f for f in normalized if f["properties"]["routeId"] == rid]), 1)
        posts = normalize_posts(self.posts, "EPSG:4326")
        self.assertEqual([p["properties"]["routeId"] for p in posts], ["R003","R003"])
        self.assertIn("note", posts[0]["properties"]["originalProperties"])

    def test_web_mercator_crs_normalization(self):
        source = [road("R001", "x")]; source[0]["geometry"]["coordinates"] = [[0,0],[1113194.9078,1118889.9748]]
        normalized = normalize_roads(source, "EPSG:3857")
        self.assertAlmostEqual(normalized[0]["geometry"]["coordinates"][1][0], 10, places=5)
        self.assertAlmostEqual(normalized[0]["geometry"]["coordinates"][1][1], 10, places=5)

    def test_manifests_provenance_route_link_and_indexes(self):
        metadata = {"provider":"CODH", "datasetLandingPage":"https://example.test/", "license":"fixture license", "attribution":"fixture attribution", "roads":{"sourceUrl":"https://example.test/roads"}, "posts":{"sourceUrl":"https://example.test/posts"}}
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); rp=root/"roads.geojson"; pp=root/"posts.geojson"
            rp.write_text(json.dumps({"type":"FeatureCollection","features":self.roads})); pp.write_text(json.dumps({"type":"FeatureCollection","features":self.posts}))
            roads_manifest, posts_manifest = run(rp, pp, root/"road-cache", root/"post-cache", metadata, extension=".geojson")
            self.assertEqual(roads_manifest["routeIdsPresent"], [f"R00{i}" for i in range(1,7)])
            self.assertEqual(posts_manifest["countsByRouteId"], {"R003":2})
            self.assertEqual(roads_manifest["license"], "fixture license")
            self.assertEqual(posts_manifest["attribution"], "fixture attribution")
            self.assertEqual(roads_manifest["normalizedCrs"], "EPSG:4326")
            self.assertEqual(json.loads((root/"post-cache/index.json").read_text())[0]["routeId"], "R003")


if __name__ == "__main__": unittest.main()
