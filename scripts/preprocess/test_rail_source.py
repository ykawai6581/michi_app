"""Offline fixture tests for reusable OSM rail normalization."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from rail_source import normalize, overpass_query, run
from source_normalization import load_osm_pbf, pbf_layer_names

POLICY = {"includedRailwayValues": ["rail", "subway", "light_rail", "tram"], "stationRailwayValues": ["station", "halt"]}


def feature(fid, railway, geometry, **properties):
    kind, oid = fid.split("/")
    return {"type": "Feature", "id": fid, "properties": {"railway": railway, "osm_element_type": kind, "osm_element_id": int(oid), **properties}, "geometry": geometry}


class FakeCrs:
    def to_string(self): return "EPSG:4326"


class FakeFrame:
    crs = FakeCrs()
    def __init__(self, features): self.features = features
    def to_json(self): return json.dumps({"type": "FeatureCollection", "features": self.features})


class FakePyogrio:
    def __init__(self, layers): self.layers = layers; self.calls = []
    def list_layers(self, path): return [[name, None] for name in self.layers]
    def read_dataframe(self, path, layer, where=None):
        self.calls.append((layer, where)); return FakeFrame(self.layers[layer])


class RailSourceTests(unittest.TestCase):
    def setUp(self):
        self.features = [
            feature("way/1", "rail", {"type":"LineString", "coordinates":[[139,35],[140,35]]}, name="Main", operator="JR", service="yard", usage="main"),
            feature("way/2", "subway", {"type":"LineString", "coordinates":[[139,35.001],[140,35.001]]}, network="Metro", service="siding"),
            feature("way/7", "light_rail", {"type":"LineString", "coordinates":[[139,35.002],[140,35.002]]}, service="spur"),
            feature("way/8", "tram", {"type":"LineString", "coordinates":[[139,35.003],[140,35.003]]}),
            feature("way/3", "construction", {"type":"LineString", "coordinates":[[0,0],[1,1]]}),
            feature("node/4", "station", {"type":"Point", "coordinates":[139.5,35.5]}, name="Same Name", wikidata="Q1"),
            feature("way/5", "station", {"type":"Polygon", "coordinates":[[[139,35],[139.2,35],[139.2,35.2],[139,35.2],[139,35]]]}, name="Same Name", wikidata="Q1"),
            feature("node/4", "station", {"type":"Point", "coordinates":[139.5,35.5]}, name="Same Name"),
        ]

    def test_config_policy_properties_duplicates_and_parallel_tracks(self):
        tracks, stations, routes, memberships = normalize(self.features, POLICY)
        self.assertEqual([t["properties"]["railway"] for t in tracks], ["rail", "subway", "light_rail", "tram"])
        self.assertEqual([t["properties"].get("service") for t in tracks[:3]], ["yard", "siding", "spur"])
        self.assertEqual(tracks[0]["properties"]["usage"], "main")
        self.assertEqual(len(tracks), 4)  # parallel/source ways are never collapsed
        self.assertEqual(len(stations), 2)  # same authority/name retained; exact node duplicate removed
        self.assertEqual(stations[1]["properties"]["sourceGeometryType"], "Polygon")

    def test_configuration_is_authoritative_for_normalize_and_overpass(self):
        policy = {"includedRailwayValues": ["construction"], "stationRailwayValues": ["stop"]}
        tracks, stations, routes, memberships = normalize(self.features + [feature("node/9", "stop", {"type":"Point", "coordinates":[1,2]})], policy)
        self.assertEqual([track["properties"]["railway"] for track in tracks], ["construction"])
        self.assertEqual([station["properties"]["railway"] for station in stations], ["stop"])
        query = overpass_query([1,2,3,4], policy)
        self.assertIn("construction", query); self.assertIn("stop", query); self.assertNotIn("subway", query)

    def test_manifest_counts_categories_and_service_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "rail.geojson"
            source.write_text(json.dumps({"type":"FeatureCollection", "features":self.features}))
            manifest = run(source, root / "cache", POLICY, configured_bounds=[138.9,35.45,140,35.95], extension=".geojson")
            self.assertEqual(manifest["featureCounts"], {"tracks":4, "stations":2, "routes":0, "routeMembers":0})
            self.assertEqual(manifest["trackCountsByRailway"], {"light_rail":1, "rail":1, "subway":1, "tram":1})
            self.assertIn("yard, siding and spur", manifest["selection"]["policy"])

    def test_route_relation_is_canonical_and_preserves_all_members(self):
        ways=[feature(f"way/{i}","rail",{"type":"LineString","coordinates":[[139+i/100,35],[139+i/100,35.1]]},name=name) for i,name in [(21,"京王電鉄京王線"),(22,"京王電鉄京王線;多磨霊園;1番線"),(23,"京王電鉄京王線;多磨霊園;2番線")]]
        relation={"type":"Feature","id":"relation/100","properties":{"osm_element_type":"relation","osm_element_id":100,"type":"route","route":"railway","name:ja":"京王線","osm_members":[{"type":"way","ref":21,"role":""},{"type":"way","ref":22,"role":"forward"},{"type":"way","ref":23,"role":""}]},"geometry":None}
        tracks,stations,routes,memberships=normalize([*ways,relation],POLICY)
        self.assertEqual((len(tracks),len(routes),len(memberships)),(3,1,3))
        self.assertEqual(routes[0]["properties"]["name:ja"],"京王線")
        self.assertEqual(len(routes[0]["geometry"]["coordinates"]),3)
        self.assertEqual([m["properties"]["osm_way_id"] for m in memberships],["21","22","23"])

    def test_pbf_layer_discovery_and_multiple_layer_loading(self):
        layers = {
            "points": [feature("node/10", "station", {"type":"Point", "coordinates":[1,2]})],
            "lines": [feature("way/11", "rail", {"type":"LineString", "coordinates":[[1,2],[2,3]]})],
            "multipolygons": [feature("way/12", "station", {"type":"Polygon", "coordinates":[[[1,2],[2,2],[2,3],[1,2]]]})],
            "buildings": [],
        }
        driver = FakePyogrio(layers)
        self.assertEqual(pbf_layer_names(Path("fixture.osm.pbf"), driver), ["points", "lines", "multipolygons"])
        features, crs, read_layers = load_osm_pbf(Path("fixture.osm.pbf"), driver)
        self.assertEqual(len(features), 3); self.assertEqual(crs, "EPSG:4326")
        self.assertEqual(read_layers, ["points", "lines", "multipolygons"])
        self.assertTrue(all(call[1] for call in driver.calls))


if __name__ == "__main__": unittest.main()
