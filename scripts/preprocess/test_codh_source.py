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
    return {"type":"Feature", "properties":{"numbering":rid,"name":name,"alt_name":f"{name}別名","start":"起点","end":"終点"}, "geometry":{"type":"LineString","coordinates":[[139,y],[140,y+0.1]]}}


def post(post_id, route_id, name, jk_id="130000166300", x=139):
    return {"type":"Feature", "properties":{"id":post_id,"jk_id":jk_id,"name":name,"jk":f"{name}（よみ）","road_id":route_id}, "geometry":{"type":"Point","coordinates":[x,35]}}


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
        for value in ["R001", "R003", "R400", "R400-1", "R400-2", "R810-1"]:
            self.assertEqual(route_id({"numbering":value}), value)
        for value in ["R40", "R400-", "R400-A", "r400", "R400-1-2", "P001"]:
            with self.subTest(value=value), self.assertRaises(ValueError): route_id({"RouteID":value})

    def test_branch_ids_preserved_and_linked_exactly(self):
        roads = normalize_roads([road("R400-1", "branch")], "EPSG:4326")
        posts = normalize_posts([post("R400-1-001", "R400-1", "Branch Post")], "EPSG:4326")
        self.assertEqual(roads[0]["properties"]["routeId"], "R400-1")
        self.assertEqual(posts[0]["properties"]["routeId"], roads[0]["properties"]["routeId"])

    def test_official_road_and_post_field_mapping_and_geometry(self):
        official_road = road("R810-1", "支線"); official_post = post("R003-002", "R003", "内藤新宿")
        normalized_road = normalize_roads([official_road], "EPSG:4326")[0]
        self.assertEqual({key: normalized_road["properties"][key] for key in ("routeId","name","altName","start","end")},
                         {"routeId":"R810-1","name":"支線","altName":"支線別名","start":"起点","end":"終点"})
        self.assertEqual(normalized_road["geometry"], official_road["geometry"])
        normalized_post = normalize_posts([official_post], "EPSG:4326")[0]
        self.assertEqual({key: normalized_post["properties"][key] for key in ("postId","routeId","name","historicalLabel","historicalPlaceId")},
                         {"postId":"R003-002","routeId":"R003","name":"内藤新宿","historicalLabel":"内藤新宿（よみ）","historicalPlaceId":"130000166300"})
        self.assertEqual(normalized_post["geometry"], official_post["geometry"])

    def test_geometry_crs_manifests_license_and_counts(self):
        roads = [road("R001", "東海道"), road("R200", "街道", 35.1), road("R200", "街道", 35.2)]
        posts = [post("R003-001","R003","日本橋",x=139.0), post("R003-002","R003","内藤新宿",x=139.1),
                 post("R004-001","R004","日本橋",x=139.0), post("R004-002","R004","別地点",x=139.2)]
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); rp=root/"roads.geojson"; pp=root/"posts.geojson"
            rp.write_text(json.dumps({"type":"FeatureCollection","features":roads})); pp.write_text(json.dumps({"type":"FeatureCollection","features":posts}))
            road_details={"rawPath":"raw.zip","sourceContainerFormat":"zip","payloadFormat":"geopackage",
                          "archiveMember":"geopackage/edo-road-v4.gpkg","extractedPath":"extracted/geopackage/edo-road-v4.gpkg",
                          "availableLayers":["edo_road"],"selectedLayer":"edo_road"}
            post_details={"rawPath":"post.geojson","sourceContainerFormat":"geojson","payloadFormat":"geojson"}
            rm, pm = run(rp, pp, root/"road-cache", root/"post-cache", metadata(), extension=".geojson",
                         source_details=(road_details, post_details))
            self.assertEqual(rm["routeIdsPresent"], ["R001", "R200"]); self.assertEqual(pm["countsByRouteId"], {"R003":2,"R004":2})
            self.assertEqual(rm["routeStatistics"]["R200"]["featureCount"], 2)
            self.assertEqual(rm["license"], "Creative Commons Attribution 4.0 International (CC BY 4.0)")
            self.assertEqual(rm["normalizedCrs"], "EPSG:4326"); self.assertEqual(rm["downloadUrl"], "https://example.test/data.zip")
            self.assertEqual(rm["rawArchivePath"], "raw.zip"); self.assertEqual(rm["archiveMember"], "geopackage/edo-road-v4.gpkg")
            self.assertEqual(rm["availableLayers"], ["edo_road"]); self.assertEqual(rm["selectedLayer"], "edo_road")
            self.assertEqual(pm["sourceContainerFormat"], "geojson")
            road_index=json.loads((root/"road-cache/index.json").read_text()); post_index=json.loads((root/"post-cache/index.json").read_text())
            self.assertEqual([item["id"] for item in road_index].count("R200"), 1); self.assertEqual(next(item for item in road_index if item["id"]=="R200")["featureCount"], 2)
            self.assertEqual([item["postId"] for item in post_index], ["R003-001","R003-002","R004-001","R004-002"])
            self.assertEqual(len({item["postId"] for item in post_index}), 4)

    def test_post_identity_uses_source_id_and_conflicts_fail(self):
        posts=[post("R003-003","R003","下高井戸","shared",139.3), post("R003-004","R003","上高井戸","shared",139.4),
               post("R005-001","R005","下高井戸","shared",139.3)]
        self.assertEqual(len(normalize_posts(posts, "EPSG:4326")), 3)
        conflict=json.loads(json.dumps(posts[0])); conflict["properties"]["name"]="衝突"
        with self.assertRaisesRegex(ValueError, "conflicting.*R003-003"):
            normalize_posts([posts[0], conflict], "EPSG:4326")

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
            config["layer"]="missing_layer"
            with self.assertRaisesRegex(RuntimeError, "missing_layer.*official_roads"):
                prepare_source(config, True, opener=lambda request, timeout: Response(body), gpkg_inspector=lambda candidate:["official_roads"])

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
                    "extractedDirectory":str(extracted),"layer":"road_codh_260731"}
            inspected=[]
            def inspector(path): inspected.append((path, path.read_bytes())); return ["road_codh_260731"]
            source, layer, details=prepare_source(config, True, opener=lambda request, timeout: Response(archive.getvalue(), "application/zip"), gpkg_inspector=inspector)
            self.assertEqual(source, extracted/"geopackage/edo-road-v4.gpkg")
            self.assertEqual(inspected, [(source, gpkg)])  # ZIP bytes were never treated as SQLite.
            self.assertEqual(layer, "road_codh_260731"); self.assertEqual(details["archiveMember"], "geopackage/edo-road-v4.gpkg")
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
