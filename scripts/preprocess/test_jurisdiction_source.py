import json
from pathlib import Path
import tempfile
import unittest

from scripts.preprocess.jurisdiction_source import normalize_features, write_snapshot


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

if __name__ == "__main__": unittest.main()
