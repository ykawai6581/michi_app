import json
from pathlib import Path
import tempfile
import unittest

from scripts.preprocess.jurisdiction_source import (
    normalize_features, topology_to_feature_collection, write_snapshot,
)


def feature(name, geometry, **properties):
    return {"type":"Feature", "properties":{"name":name, **properties}, "geometry":geometry}


class JurisdictionSourceTests(unittest.TestCase):
    def setUp(self):
        self.polygon={"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}
        self.multi={"type":"MultiPolygon","coordinates":[[[[2,0],[3,0],[3,1],[2,0]]]]}
        self.document={"type":"FeatureCollection","features":[feature("A",self.polygon,parent_name="CITY",pref_name="東京府",resource_id="r-a",code="001"),feature("B",self.multi,parent_name="CITY",pref_name="東京府",resource_id="r-b")]}

    def test_normalizes_polygon_multipolygon_date_hierarchy_and_provenance(self):
        result=normalize_features(self.document,prefecture="13",snapshot_date="1931-12-31")
        self.assertEqual({f["geometry"]["type"] for f in result["features"]},{"Polygon","MultiPolygon"})
        first=next(f for f in result["features"] if f["properties"]["municipalityName"]=="A")["properties"]
        self.assertEqual((first["snapshotDate"],first["parentJurisdictionName"],first["prefectureName"]),("1931-12-31","CITY","東京府"))
        self.assertEqual((first["sourceResourceId"],first["administrativeCode"],first["sourceProvider"]),("r-a","001","Geoshape"))

    def test_ids_and_manifest_are_deterministic_across_input_order(self):
        reversed_document={**self.document,"features":list(reversed(self.document["features"]))}
        a=normalize_features(self.document,prefecture="13",snapshot_date="1931-12-31")
        b=normalize_features(reversed_document,prefecture="13",snapshot_date="1931-12-31")
        self.assertEqual(a,b)
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); source=root/"input.geojson"; output=root/"out"
            source.write_text(json.dumps(self.document),encoding="utf-8")
            first=write_snapshot(source,output,prefecture="13",prefecture_name="Tokyo",snapshot_date="1932-12-31")
            serialized=(output/"manifest.json").read_text()
            second=write_snapshot(source,output,prefecture="13",prefecture_name="Tokyo",snapshot_date="1932-12-31")
            self.assertEqual(first,second); self.assertEqual(serialized,(output/"manifest.json").read_text())
            self.assertEqual(first["providers"]["geoshape"]["prefectures"]["13"]["availableDates"],["1932-12-31"])

    def test_rejects_non_polygon_without_network(self):
        bad={"type":"FeatureCollection","features":[feature("point",{"type":"Point","coordinates":[0,0]})]}
        with self.assertRaisesRegex(ValueError,"Polygon or MultiPolygon"): normalize_features(bad,prefecture="13",snapshot_date="1931-12-31")


class TopoJsonTests(unittest.TestCase):
    fixture = Path(__file__).parent / "fixtures" / "geoshape-city-synthetic.topojson"

    def setUp(self):
        self.topology = json.loads(self.fixture.read_text(encoding="utf-8"))

    def test_transform_deltas_reversal_and_multi_arc_ring(self):
        collection = topology_to_feature_collection(self.topology)
        polygon = collection["features"][0]["geometry"]
        self.assertEqual(polygon["type"], "Polygon")
        self.assertEqual(
            polygon["coordinates"][0],
            [[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]],
        )

    def test_polygon_multipolygon_properties_and_ids_survive(self):
        collection = topology_to_feature_collection(self.topology)
        self.assertEqual(collection["features"][0]["id"], "東京府東京市杉並区")
        self.assertEqual(collection["features"][0]["properties"]["id"], "gci:13115A1968")
        self.assertEqual(collection["features"][1]["geometry"]["type"], "MultiPolygon")
        self.assertEqual(len(collection["features"][1]["geometry"]["coordinates"]), 2)

    def test_real_geoshape_aliases_temporal_metadata_and_empty_parent(self):
        normalized = normalize_features(
            topology_to_feature_collection(self.topology), prefecture="13", snapshot_date="1932-12-31"
        )
        suginami = next(f for f in normalized["features"] if f["properties"]["municipalityName"] == "杉並区")
        self.assertEqual(
            {key: suginami["properties"][key] for key in ("prefectureName", "parentJurisdictionName", "administrativeCode", "sourceResourceId")},
            {"prefectureName": "東京府", "parentJurisdictionName": "東京市", "administrativeCode": "13115", "sourceResourceId": "gci:13115A1968"},
        )
        self.assertEqual((suginami["properties"]["sourceStartYear"], suginami["properties"]["sourceEndYear"]), (1932, 2006))
        village = next(f for f in normalized["features"] if f["properties"]["municipalityName"] == "Example村")
        self.assertNotIn("parentJurisdictionName", village["properties"])

    def test_topology_write_is_deterministic_across_geometry_order(self):
        reversed_topology = json.loads(json.dumps(self.topology))
        reversed_topology["objects"]["city"]["geometries"].reverse()
        first = normalize_features(topology_to_feature_collection(self.topology), prefecture="13", snapshot_date="1932-12-31")
        second = normalize_features(topology_to_feature_collection(reversed_topology), prefecture="13", snapshot_date="1932-12-31")
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_snapshot(self.fixture, root, prefecture="13", prefecture_name="Tokyo", snapshot_date="1932-12-31")
            self.assertEqual(json.loads((root / "geoshape/13/1932-12-31.geojson").read_text())["type"], "FeatureCollection")

    def test_object_selection_and_failures_are_clear(self):
        fallback = json.loads(json.dumps(self.topology))
        fallback["objects"]["areas"] = fallback["objects"].pop("city")
        self.assertEqual(len(topology_to_feature_collection(fallback)["features"]), 3)
        with self.assertRaisesRegex(ValueError, "does not exist"):
            topology_to_feature_collection(self.topology, "missing")
        ambiguous = json.loads(json.dumps(fallback))
        ambiguous["objects"]["other"] = {"type": "GeometryCollection", "geometries": []}
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            topology_to_feature_collection(ambiguous)
        unsupported = json.loads(json.dumps(self.topology))
        unsupported["objects"]["city"]["geometries"][0]["type"] = "LineString"
        with self.assertRaisesRegex(ValueError, "unsupported Topology geometry type"):
            topology_to_feature_collection(unsupported)


if __name__ == "__main__": unittest.main()
