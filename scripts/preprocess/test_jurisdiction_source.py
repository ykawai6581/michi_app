import json
from pathlib import Path
import tempfile
import unittest

from shapely.geometry import shape

from scripts.preprocess.jurisdiction_source import (
    is_parent_city_merge_eligible, normalize_features, parent_city_display,
    topology_to_feature_collection, write_snapshot,
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
            low = first["providers"]["geoshape"]["prefectures"]["13"]["resolutions"]["low"]
            self.assertEqual(low["availableDates"],["1932-12-31"])
            self.assertEqual(json.loads((output / low["snapshots"]["1932-12-31"]["path"]).read_text())["features"][0]["properties"]["sourceResolution"], "low")

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
            self.assertEqual(json.loads((root / "geoshape/13/low/1932-12-31.geojson").read_text())["type"], "FeatureCollection")

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


class ParentCityDisplayTests(unittest.TestCase):
    @staticmethod
    def _square(x, y=0):
        return {"type": "Polygon", "coordinates": [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]}

    def setUp(self):
        raw = {"type": "FeatureCollection", "features": [
            feature("A区", self._square(0), parent_name="東京市", resource_id="ward-a", pref_name="東京府"),
            feature("B区", self._square(1), parent_name="東京市", resource_id="ward-b", pref_name="東京府"),
            feature("C区", self._square(4), parent_name="東京市", resource_id="ward-c", pref_name="東京府"),
            feature("D村", self._square(10), parent_name="西多摩郡", resource_id="village-d", pref_name="東京府"),
            feature("E村", self._square(11), parent_name="西多摩郡", resource_id="village-e", pref_name="東京府"),
            feature("八王子市", self._square(20), resource_id="city-h", pref_name="東京府"),
        ]}
        self.canonical = normalize_features(raw, prefecture="13", snapshot_date="1932-12-31")

    def test_only_ward_parent_groups_are_eligible(self):
        groups = {}
        for item in self.canonical["features"]:
            parent = item["properties"].get("parentJurisdictionName")
            if parent:
                groups.setdefault(parent, []).append(item)
        self.assertTrue(is_parent_city_merge_eligible(groups["東京市"]))
        self.assertFalse(is_parent_city_merge_eligible(groups["西多摩郡"]))

    def test_dissolve_is_complete_preserves_sources_and_removes_internal_boundary(self):
        original = json.loads(json.dumps(self.canonical))
        display = parent_city_display(self.canonical, prefecture="13", snapshot_date="1932-12-31")
        self.assertEqual(self.canonical, original)
        self.assertEqual(len(display["features"]), 4)
        names = {item["properties"]["municipalityName"] for item in display["features"]}
        self.assertEqual(names, {"東京市", "D村", "E村", "八王子市"})
        self.assertNotIn("西多摩郡", names)
        parent = next(item for item in display["features"] if item["properties"].get("derived") is True)
        self.assertEqual(parent["geometry"]["type"], "MultiPolygon")
        self.assertEqual(parent["properties"]["memberCount"], 3)
        self.assertEqual(parent["properties"]["sourceResourceIds"], ["ward-a", "ward-b", "ward-c"])
        self.assertEqual(shape(parent["geometry"]).area, 3.0)
        self.assertEqual(len(shape(parent["geometry"]).geoms), 2)
        self.assertEqual(shape(parent["geometry"]).boundary.length, 10.0)

    def test_derived_identity_and_output_are_deterministic(self):
        reversed_collection = {**self.canonical, "features": list(reversed(self.canonical["features"]))}
        first = parent_city_display(self.canonical, prefecture="13", snapshot_date="1932-12-31")
        second = parent_city_display(reversed_collection, prefecture="13", snapshot_date="1932-12-31")
        self.assertEqual(first, second)
        parent = next(item for item in first["features"] if item["properties"].get("derived"))
        self.assertEqual(parent["properties"]["memberJurisdictionIds"], sorted(parent["properties"]["memberJurisdictionIds"]))

    def test_one_command_writes_canonical_parent_display_and_manifest_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.geojson"
            source.write_text(json.dumps({"type": "FeatureCollection", "features": [
                feature("A区", self._square(0), parent_name="東京市", resource_id="a", pref_name="東京府"),
                feature("B区", self._square(1), parent_name="東京市", resource_id="b", pref_name="東京府"),
            ]}), encoding="utf-8")
            first = write_snapshot(source, root / "out", prefecture="13", prefecture_name="Tokyo", snapshot_date="1932-12-31")
            first_parent = (root / "out/geoshape/13/low/1932-12-31.parents.geojson").read_text()
            second = write_snapshot(source, root / "out", prefecture="13", prefecture_name="Tokyo", snapshot_date="1932-12-31")
            self.assertEqual(first, second)
            self.assertEqual(first_parent, (root / "out/geoshape/13/low/1932-12-31.parents.geojson").read_text())
            snapshot = first["providers"]["geoshape"]["prefectures"]["13"]["resolutions"]["low"]["snapshots"]["1932-12-31"]
            self.assertEqual(snapshot["parentDisplayPath"], "geoshape/13/low/1932-12-31.parents.geojson")
            self.assertEqual(snapshot["parentDisplayFeatureCount"], 1)

    def test_low_high_assets_manifest_and_provenance_are_independent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "source.geojson"; output = root / "out"
            source.write_text(json.dumps({"type": "FeatureCollection", "features": [
                feature("A区", self._square(0), parent_name="東京市", resource_id="a", pref_name="東京府"),
                feature("B区", self._square(1), parent_name="東京市", resource_id="b", pref_name="東京府"),
            ]}), encoding="utf-8")
            write_snapshot(source, output, prefecture="13", prefecture_name="Tokyo", snapshot_date="1932-12-31")
            manifest = write_snapshot(source, output, prefecture="13", prefecture_name="Tokyo", snapshot_date="1932-12-31", resolution="high")
            resolutions = manifest["providers"]["geoshape"]["prefectures"]["13"]["resolutions"]
            self.assertEqual(set(resolutions), {"low", "high"})
            for resolution in ("low", "high"):
                snapshot = resolutions[resolution]["snapshots"]["1932-12-31"]
                self.assertTrue((output / snapshot["path"]).exists())
                parent = json.loads((output / snapshot["parentDisplayPath"]).read_text())
                self.assertEqual({feature["properties"]["sourceResolution"] for feature in parent["features"]}, {resolution})

    def test_legacy_manifest_is_migrated_as_low_without_losing_dates(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "source.geojson"; output = root / "out"; output.mkdir()
            source.write_text(json.dumps(self.canonical), encoding="utf-8")
            legacy_snapshot = {"path": "geoshape/13/1931-12-31.geojson", "featureCount": 6}
            legacy = {"schemaVersion": 1, "providers": {"geoshape": {"displayName": "Geoshape", "dataset": "x", "datasetName": "x", "sourceUrl": "x", "caution": "x", "prefectures": {"13": {"displayName": "Tokyo", "availableDates": ["1931-12-31"], "snapshots": {"1931-12-31": legacy_snapshot}}}}}}
            (output / "manifest.json").write_text(json.dumps(legacy), encoding="utf-8")
            manifest = write_snapshot(source, output, prefecture="13", prefecture_name="Tokyo", snapshot_date="1932-12-31", resolution="high")
            prefecture = manifest["providers"]["geoshape"]["prefectures"]["13"]
            self.assertEqual(manifest["schemaVersion"], 2)
            self.assertEqual(prefecture["resolutions"]["low"]["snapshots"]["1931-12-31"], legacy_snapshot)


if __name__ == "__main__": unittest.main()
