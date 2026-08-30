"""Offline fixture tests for CODH road/post normalization and acquisition."""

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).parent))
from codh_source import download, extract_configured_archive, normalize_posts, normalize_roads, route_id, run


def road(rid, name, y=35):
    return {"type":"Feature", "id":f"road-{rid}", "properties":{"route_id":rid,"road_name":name,"extra":"kept"}, "geometry":{"type":"LineString","coordinates":[[139,y],[140,y+0.1]]}}


def metadata():
    common = {"landingPage":"https://example.test/landing", "downloadUrl":"https://example.test/data.zip", "license":"Creative Commons Attribution 4.0 International (CC BY 4.0)", "licenseUrl":"https://creativecommons.org/licenses/by/4.0/", "attribution":"CODH"}
    return {"provider":"CODH", "normalizedCrs":"EPSG:4326", "roads":{**common,"datasetName":"江戸主要街道データセット"}, "posts":{**common,"datasetName":"江戸宿場データセット"}}


class Response(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *args): self.close()


class CodhSourceTests(unittest.TestCase):
    def test_route_id_syntax(self):
        for value in ["R001", "R400", "R400-1", "R810-1"]:
            self.assertEqual(route_id({"RouteID":value}), value)
        for value in ["R40", "R400-", "R400-A", "r400", "R400-1-2", "P001"]:
            with self.subTest(value=value), self.assertRaises(ValueError): route_id({"RouteID":value})

    def test_branch_ids_preserved_and_linked_exactly(self):
        roads = normalize_roads([road("R400-1", "branch")], "EPSG:4326")
        posts = normalize_posts([{"type":"Feature","id":"P1","properties":{"RouteID":"R400-1","Name":"Branch Post"},"geometry":{"type":"Point","coordinates":[139,35]}}], "EPSG:4326")
        self.assertEqual(roads[0]["properties"]["routeId"], "R400-1")
        self.assertEqual(posts[0]["properties"]["routeId"], roads[0]["properties"]["routeId"])

    def test_official_schema_field_names(self):
        # Current CODH layers expose route identifiers/names as ID/Name on roads
        # and RouteID/PostID/Name on posts.
        official_road = {"type":"Feature","properties":{"ID":"R810-1","Name":"支線"},"geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]}}
        official_post = {"type":"Feature","properties":{"PostID":"S81001","RouteID":"R810-1","Name":"宿場"},"geometry":{"type":"Point","coordinates":[1,2]}}
        self.assertEqual(normalize_roads([official_road], "EPSG:4326")[0]["properties"]["routeId"], "R810-1")
        self.assertEqual(normalize_posts([official_post], "EPSG:4326")[0]["properties"]["postId"], "S81001")

    def test_geometry_crs_manifests_license_and_counts(self):
        roads = [road("R001", "東海道"), road("R400-1", "branch")]
        posts = [{"type":"Feature","id":"P1","properties":{"RouteID":"R400-1","Name":"宿"},"geometry":{"type":"Point","coordinates":[139,35]}}]
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); rp=root/"roads.geojson"; pp=root/"posts.geojson"
            rp.write_text(json.dumps({"type":"FeatureCollection","features":roads})); pp.write_text(json.dumps({"type":"FeatureCollection","features":posts}))
            rm, pm = run(rp, pp, root/"road-cache", root/"post-cache", metadata(), extension=".geojson")
            self.assertEqual(rm["routeIdsPresent"], ["R001", "R400-1"]); self.assertEqual(pm["countsByRouteId"], {"R400-1":1})
            self.assertEqual(rm["license"], "Creative Commons Attribution 4.0 International (CC BY 4.0)")
            self.assertEqual(rm["normalizedCrs"], "EPSG:4326"); self.assertEqual(rm["downloadUrl"], "https://example.test/data.zip")

    def test_automatic_download_and_deterministic_archive_member(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); archive=root/"source.zip"
            calls=[]
            def opener(request, timeout): calls.append(request.full_url); return Response(b"download")
            self.assertTrue(download(archive, "https://example.test/source.zip", False, opener))
            self.assertEqual(archive.read_bytes(), b"download"); self.assertEqual(calls, ["https://example.test/source.zip"])
            with zipfile.ZipFile(archive, "w") as target:
                target.writestr("nested/roads.gpkg", b"gpkg"); target.writestr("other.gpkg", b"wrong")
            extracted = extract_configured_archive(archive, root/"extracted", "roads.gpkg")
            self.assertEqual(extracted.read_bytes(), b"gpkg")
            with self.assertRaises(RuntimeError): extract_configured_archive(archive, root/"bad", "missing.gpkg")


if __name__ == "__main__": unittest.main()
