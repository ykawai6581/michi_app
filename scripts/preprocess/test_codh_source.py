"""Offline fixture tests for CODH road/post normalization and acquisition."""

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).parent))
from codh_source import download, normalize_posts, normalize_roads, prepare_source, route_id, run, select_archive_member


def road(rid, name, y=35):
    return {"type":"Feature", "id":f"road-{rid}", "properties":{"route_id":rid,"road_name":name,"extra":"kept"}, "geometry":{"type":"LineString","coordinates":[[139,y],[140,y+0.1]]}}


def metadata():
    common = {"landingPage":"https://example.test/landing", "downloadUrl":"https://example.test/data.zip", "license":"Creative Commons Attribution 4.0 International (CC BY 4.0)", "licenseUrl":"https://creativecommons.org/licenses/by/4.0/", "attribution":"CODH"}
    return {"provider":"CODH", "normalizedCrs":"EPSG:4326", "roads":{**common,"datasetName":"江戸主要街道データセット"}, "posts":{**common,"datasetName":"江戸宿場データセット"}}


class Response(io.BytesIO):
    status = 200
    def __init__(self, value, content_type="application/octet-stream", final_url="https://cdn.example.test/final"):
        super().__init__(value); self.headers = {"Content-Type": content_type}; self.final_url = final_url
    def geturl(self): return self.final_url
    def getcode(self): return self.status
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
            road_details={"rawPath":"raw.zip","sourceContainerFormat":"zip","payloadFormat":"geopackage",
                          "archiveMember":"geopackage/edo-road-v4.gpkg","extractedPath":"extracted/geopackage/edo-road-v4.gpkg",
                          "availableLayers":["edo_road"],"selectedLayer":"edo_road"}
            post_details={"rawPath":"post.geojson","sourceContainerFormat":"geojson","payloadFormat":"geojson"}
            rm, pm = run(rp, pp, root/"road-cache", root/"post-cache", metadata(), extension=".geojson",
                         source_details=(road_details, post_details))
            self.assertEqual(rm["routeIdsPresent"], ["R001", "R400-1"]); self.assertEqual(pm["countsByRouteId"], {"R400-1":1})
            self.assertEqual(rm["license"], "Creative Commons Attribution 4.0 International (CC BY 4.0)")
            self.assertEqual(rm["normalizedCrs"], "EPSG:4326"); self.assertEqual(rm["downloadUrl"], "https://example.test/data.zip")
            self.assertEqual(rm["rawArchivePath"], "raw.zip"); self.assertEqual(rm["archiveMember"], "geopackage/edo-road-v4.gpkg")
            self.assertEqual(rm["availableLayers"], ["edo_road"]); self.assertEqual(rm["selectedLayer"], "edo_road")
            self.assertEqual(pm["sourceContainerFormat"], "geojson")

    def test_direct_geojson_download_validates_and_records_redirect(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/"posts.geojson"; payload=json.dumps({"type":"FeatureCollection","features":[]}).encode()
            config={"datasetName":"posts","downloadUrl":"https://example.test/posts","rawPath":str(path),"format":"geojson"}
            result=download(config, False, lambda request, timeout: Response(payload, "application/geo+json"))
            self.assertEqual(json.loads(path.read_text())["type"], "FeatureCollection")
            self.assertEqual(result["finalResponseUrl"], "https://cdn.example.test/final")
            self.assertEqual(result["responseContentType"], "application/geo+json")

    def test_geopackage_download_is_opened_and_layer_selected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/"roads.gpkg"; body=b"SQLite format 3\x00" + b"fixture"
            config={"datasetName":"roads","downloadUrl":"https://example.test/roads","rawPath":str(path),"format":"geopackage"}
            inspected=[]
            def inspector(candidate): inspected.append(candidate.read_bytes()); return ["official_roads"]
            source, layer, details=prepare_source(config, True, opener=lambda request, timeout: Response(body, "application/geopackage+sqlite3"), gpkg_inspector=inspector)
            self.assertEqual(source, path); self.assertEqual(layer, "official_roads")
            self.assertEqual(inspected, [body]); self.assertEqual(details["sourceContainerFormat"], "geopackage")

    def test_zip_geopackage_nested_member_is_extracted_then_validated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); raw=root/"road.zip"; extracted=root/"extracted"
            archive=io.BytesIO()
            gpkg=b"SQLite format 3\x00"+b"road fixture"
            with zipfile.ZipFile(archive, "w") as target:
                target.writestr("geopackage/edo-road-v4.gpkg", gpkg)
                target.writestr("README.txt", "metadata")
            config={"datasetName":"roads","downloadUrl":"https://example.test/geopackage.zip","rawPath":str(raw),
                    "format":"zip","payloadFormat":"geopackage","archiveMember":"geopackage/edo-road-v4.gpkg",
                    "extractedDirectory":str(extracted)}
            inspected=[]
            def inspector(path): inspected.append((path, path.read_bytes())); return ["edo_road"]
            source, layer, details=prepare_source(config, True, opener=lambda request, timeout: Response(archive.getvalue(), "application/zip"), gpkg_inspector=inspector)
            self.assertEqual(source, extracted/"geopackage/edo-road-v4.gpkg")
            self.assertEqual(inspected, [(source, gpkg)])  # ZIP bytes were never treated as SQLite.
            self.assertEqual(layer, "edo_road"); self.assertEqual(details["archiveMember"], "geopackage/edo-road-v4.gpkg")
            self.assertEqual(details["sourceContainerFormat"], "zip"); self.assertEqual(details["payloadFormat"], "geopackage")

    def test_archive_member_discovery_errors_are_actionable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            no_gpkg=root/"none.zip"
            with zipfile.ZipFile(no_gpkg, "w") as target: target.writestr("README", "none")
            with self.assertRaisesRegex(RuntimeError, "contains no GeoPackage"):
                select_archive_member(no_gpkg)
            multiple=root/"multiple.zip"
            with zipfile.ZipFile(multiple, "w") as target:
                target.writestr("a.gpkg", b"a"); target.writestr("nested/b.gpkg", b"b")
            with self.assertRaisesRegex(RuntimeError, "ambiguous GeoPackage members.*a.gpkg.*nested/b.gpkg"):
                select_archive_member(multiple)
            with self.assertRaisesRegex(RuntimeError, "missing configured archiveMember.*missing.gpkg.*a.gpkg"):
                select_archive_member(multiple, "missing.gpkg")

    def test_html_and_invalid_zip_are_rejected_and_temporary_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for expected, body, content_type in [("geojson", b"<html>404</html>", "text/html"), ("geojson", b"not json", "application/geo+json"), ("zip", b"not zip", "application/zip")]:
                path=root/f"source-{expected}.dat"; path.write_bytes(b"existing-valid-cache")
                config={"datasetName":f"fixture {expected}","downloadUrl":"https://example.test/bad","rawPath":str(path),"format":expected}
                with self.subTest(expected=expected), self.assertRaisesRegex(RuntimeError, f"fixture {expected}.*expected {expected}"):
                    download(config, True, lambda request, timeout, b=body, c=content_type: Response(b, c))
                self.assertEqual(path.read_bytes(), b"existing-valid-cache")
                self.assertFalse(path.with_suffix(path.suffix+".part").exists())


if __name__ == "__main__": unittest.main()
