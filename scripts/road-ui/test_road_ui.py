"""Local-only Road Builder service tests."""

from __future__ import annotations

import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import LineString

import road_ui


ROAD = {
    "id": "tokyo-named-test-dori", "displayName": "テスト通り", "entityType": "named-road",
    "jurisdiction": "Tokyo", "aliases": ["テスト通り", "テスト通り"],
    "reference": {"type": "osm-name", "names": ["テスト通り", "テスト通り"], "tags": ["name"]},
    "n13": {"classifications": ["2"]},
    "matching": {"sampleIntervalMeters": 5, "maximumMedianResidualMeters": 20,
                 "maximumP90ResidualMeters": 25, "coverageToleranceMeters": 25},
}


class RoadBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.registry = Path(self.temp.name) / "registry.json"
        self.registry.write_text(json.dumps({"display": {}, "roads": [ROAD]}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_list_and_load(self):
        self.assertEqual(road_ui.list_roads(self.registry)[0]["id"], ROAD["id"])
        self.assertEqual(road_ui.get_road(self.registry, ROAD["id"])["displayName"], "テスト通り")

    def test_validate_named_draft_deduplicates(self):
        result = road_ui.validate_road(ROAD)
        self.assertEqual(result["aliases"], ["テスト通り"])
        self.assertEqual(result["reference"]["names"], ["テスト通り"])

    def test_statutory_network_is_preserved_on_save_and_load(self):
        road = {**copy.deepcopy(ROAD), "id": "jp-national-20", "displayName": "国道20号",
                "entityType": "statutory-road", "roadClass": "national",
                "reference": {"type": "osm-ref", "ref": "20", "network": "JP:national",
                              "excludeNames": ["八王子南バイパス"]}}
        road_ui.save_road(self.registry, road)
        loaded = road_ui.get_road(self.registry, road["id"])
        self.assertEqual(loaded["reference"], road["reference"])
        self.assertEqual(loaded["n13"]["classifications"], ROAD["n13"]["classifications"])

    def test_atomic_create_edit_and_duplicate(self):
        new = copy.deepcopy(ROAD)
        new["id"] = "tokyo-named-another-dori"
        road_ui.save_road(self.registry, new)
        with self.assertRaises(RuntimeError):
            road_ui.save_road(self.registry, new)
        new["displayName"] = "変更"
        road_ui.save_road(self.registry, new, new["id"])
        self.assertEqual(road_ui.get_road(self.registry, new["id"])["displayName"], "変更")
        self.assertFalse(list(self.registry.parent.glob("tmp*")))

    @patch.object(road_ui, "_context")
    def test_osm_inspection_uses_local_frame(self, context):
        osm = gpd.GeoDataFrame({"name": ["テスト通り"], "name:en": ["Test Dori"],
                                "osm_way_id": [123], "geometry": [LineString([(0, 0), (1, 0)])]},
                               crs=road_ui.MATCHER.METRIC_CRS)
        context.return_value = (ROAD, Path(), osm, osm.geometry.iloc[0], {}, {"componentCount": 1})
        result = road_ui.inspect_osm(ROAD)
        self.assertEqual(result["summary"]["wayCount"], 1)
        self.assertIn("Test Dori", result["discoveredNames"])
        self.assertIn("referenceExcluded", result)

    @patch.object(road_ui, "_context")
    def test_osm_inspection_reports_exact_tokens_and_excluded_geometry(self, context):
        road = {**copy.deepcopy(ROAD), "id": "jp-national-20", "entityType": "statutory-road",
                "reference": {"type": "osm-ref", "ref": "20", "network": "JP:national",
                              "excludeNames": ["八王子南バイパス"]}}
        osm = gpd.GeoDataFrame({"name": ["甲州街道", "別名;八王子南バイパス"],
                                "osm_way_id": [1, 2], "geometry": [
                                    LineString([(0, 0), (1, 0)]), LineString([(0, 1), (1, 1)])]},
                               crs=road_ui.MATCHER.METRIC_CRS)
        context.return_value = (road, Path(), osm, osm.geometry.iloc[0], {}, {})
        result = road_ui.inspect_osm(road)
        self.assertEqual(result["discoveredNames"], ["八王子南バイパス", "別名", "甲州街道"])
        self.assertEqual(len(result["referenceExcluded"]["features"]), 1)
        self.assertEqual(result["summary"]["excludedByExactNameCount"], 1)

    def test_geojson_preserves_and_serializes_pandas_and_numpy_scalars(self):
        frame = gpd.GeoDataFrame({
            "N13_001": [pd.Timestamp("2024-04-01T12:34:56")],
            "featureCount": np.array([np.int64(7)]),
            "residual": np.array([np.float64(3.25)]),
            "geometry": [LineString([(139.0, 35.0), (139.1, 35.1)])],
        }, crs="EPSG:4326")

        geojson = road_ui._geojson(frame)
        properties = geojson["features"][0]["properties"]
        self.assertEqual(properties["N13_001"], "2024-04-01 12:34:56")
        self.assertEqual(properties["featureCount"], 7)
        self.assertEqual(properties["residual"], 3.25)
        # Exercise the same outer encoding performed by server.Handler._send
        # with every GeoJSON-bearing field in a complete preview response.
        response = {
            "reference": geojson,
            "candidates": geojson,
            "residualPass": geojson,
            "selected": geojson,
            "diagnostics": geojson,
            "report": {"candidateCount": np.int64(1)},
        }
        # The GeoJSON portions themselves must pass strict standard encoding.
        json.dumps({key: value for key, value in response.items() if key != "report"})
        # The HTTP boundary also safely handles any numpy/date-like diagnostic
        # scalar that an existing matcher report happens to expose.
        json.dumps(response, default=str)

    def test_match_preview_layers_are_atom_disjoint_and_rejected_is_filtered(self):
        diagnostics = gpd.GeoDataFrame({
            "n13FeatureId": ["feature-a", "feature-b"], "n13AtomId": ["a:0", "b:0"],
            "selectionStatus": ["accepted-owned-samples", "rejected-no-owned-run"],
            "automaticSelection": [True, False],
            "geometry": [LineString([(0, 0), (10, 0)]), LineString([(0, 2), (10, 2)])],
        }, crs=road_ui.MATCHER.METRIC_CRS)
        selected = diagnostics.iloc[[0]].copy()
        selected.at[selected.index[0], "geometry"] = LineString([(2, 0), (4, 0)])
        candidates = gpd.GeoDataFrame({
            "n13FeatureId": ["feature-a", "feature-b", "feature-c"],
            "n13AtomId": ["a:0", "b:0", "c:0"],
            "geometry": [LineString([(0, 0), (10, 0)]), LineString([(0, 2), (10, 2)]),
                         LineString([(0, 20), (10, 20)])],
        }, crs=road_ui.MATCHER.METRIC_CRS)
        adjacency = {"a:0": ["b:0"], "b:0": ["a:0"], "c:0": []}
        layers = road_ui._match_preview_layers({
            "selectionDiagnostics": diagnostics, "selected": selected, "candidates": candidates,
            "sourceAtoms": candidates, "sourceAdjacency": adjacency})
        auto_ids = {item["properties"]["n13AtomId"] for item in layers["autoSelected"]["features"]}
        shortlist_ids = {item["properties"]["n13AtomId"] for item in layers["unselectedShortlist"]["features"]}
        self.assertEqual(auto_ids, {"a:0"})
        self.assertEqual(layers["autoSelected"]["features"][0]["geometry"],
                         road_ui._geojson(selected)["features"][0]["geometry"])
        self.assertNotEqual(layers["autoSelected"]["features"][0]["geometry"],
                            layers["autoSelectedSourceAtoms"]["features"][0]["geometry"])
        self.assertEqual(shortlist_ids, {"b:0"})
        self.assertFalse(auto_ids & shortlist_ids)
        self.assertTrue(all(item["properties"]["selectionStatus"].startswith("rejected-")
                            for item in layers["rejectedDiagnostics"]["features"]))
        self.assertEqual({item["properties"]["n13AtomId"]
                          for item in layers["residualRejected"]["features"]}, {"c:0"})
        self.assertEqual({item["properties"]["n13AtomId"]
                          for item in layers["sourceAtoms"]["features"]}, {"a:0", "b:0", "c:0"})
        self.assertEqual(layers["sourceAdjacency"], adjacency)

    @patch.object(road_ui, "_context")
    @patch.object(road_ui.MATCHER, "load_n13_candidates")
    @patch.object(road_ui.MATCHER, "match_n13")
    @patch.object(road_ui, "metadata", return_value={})
    def test_n13_analysis_summary(self, _, match, load, context):
        frame = gpd.GeoDataFrame({"N13_003": ["2"], "match_median_m": [4.0],
                                  "geometry": [LineString([(0, 0), (10, 0)])]}, crs=road_ui.MATCHER.METRIC_CRS)
        context.return_value = (ROAD, Path(), None, frame.geometry.iloc[0], {}, {})
        load.return_value = frame
        match.return_value = (frame, frame)
        summary = road_ui.analyze_n13(ROAD)["classes"][0]
        self.assertEqual(summary["residualPassFeatures"], 1)
        self.assertTrue(summary["suggested"])

    def test_missing_partition_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Path(directory) / "sources.json"
            sources.write_text(json.dumps({"osm": {}, "n13": {"cache": directory + "/missing"}}))
            self.assertEqual(len(road_ui.metadata(sources)["missingClasses"]), 6)

    @patch.object(road_ui.MATCHER, "load_source_config")
    def test_prepare_class_safe_direct_invocation(self, config):
        root = Path(self.temp.name) / "cache"
        raw = Path(self.temp.name) / "raw.geojson"
        raw.write_text("{}")
        root.mkdir()
        (root / "manifest.json").write_text(json.dumps({"source": str(raw), "availableClasses": []}))
        config.return_value = {"n13": {"cache": str(root)}}
        runner = Mock(return_value={"classes": ["5"]})
        self.assertEqual(road_ui.prepare_class("5", runner=runner)["classes"], ["5"])
        runner.assert_called_once_with(raw, root, ["5"])

    @patch.object(road_ui, "_context", side_effect=RuntimeError("preview stopped"))
    def test_preview_never_modifies_registry(self, _):
        before = self.registry.read_bytes()
        with self.assertRaises(RuntimeError):
            road_ui.preview_match(ROAD)
        self.assertEqual(self.registry.read_bytes(), before)

    def test_matching_relevant_changes_alter_draft_hash(self):
        baseline = road_ui.draft_hash(ROAD)
        changed_setting = copy.deepcopy(ROAD)
        changed_setting["matching"]["coverageToleranceMeters"] += 1
        changed_classes = copy.deepcopy(ROAD)
        changed_classes["n13"]["classifications"] = ["3", "2"]
        changed_exclusions = copy.deepcopy(ROAD)
        changed_exclusions["reference"]["excludeNames"] = ["Bypass"]
        self.assertNotEqual(baseline, road_ui.draft_hash(changed_setting))
        self.assertNotEqual(baseline, road_ui.draft_hash(changed_classes))
        self.assertNotEqual(baseline, road_ui.draft_hash(changed_exclusions))

    def test_background_preview_returns_immediately_and_reports_monotonic_progress(self):
        cache = Path(self.temp.name) / "previews"
        expected = {"previewId": "replaced", "selected": {"features": []}}

        def preview(draft, sources, target_cache, progress_callback, preview_id):
            for progress in (5, 25, 42, 80, 95):
                progress_callback(progress=progress, phase="Matching reference samples",
                                  completed=progress, total=100)
                time.sleep(.005)
            return {**expected, "previewId": preview_id}

        with patch.object(road_ui, "preview_match", side_effect=preview):
            started_at = time.perf_counter()
            started = road_ui.start_preview_job(ROAD, cache=cache)
            self.assertLess(time.perf_counter() - started_at, .1)
            observed = []
            while True:
                job = road_ui.get_preview_job(started["jobId"])
                observed.append(job["progress"])
                if job["status"] != "running":
                    break
                time.sleep(.002)
        self.assertEqual(job["status"], "complete")
        self.assertEqual(job["progress"], 100)
        self.assertEqual(job["result"]["selected"], expected["selected"])
        self.assertEqual(observed, sorted(observed))

    def test_background_preview_retains_structured_failure(self):
        with patch.object(road_ui, "preview_match", side_effect=ValueError("bad settings")):
            started = road_ui.start_preview_job(ROAD, cache=Path(self.temp.name) / "previews")
            while road_ui.get_preview_job(started["jobId"])["status"] == "running":
                time.sleep(.002)
        job = road_ui.get_preview_job(started["jobId"])
        self.assertEqual(job["phase"], "Preview failed")
        self.assertEqual(job["error"], {"type": "ValueError", "message": "bad settings"})

    def test_unknown_preview_fails_without_computing(self):
        with patch.object(road_ui.MATCHER, "compute_road_build") as compute:
            with self.assertRaisesRegex(RuntimeError, "Final preview is stale"):
                road_ui.build_road(ROAD["id"], "unknown", ROAD, self.registry,
                                   cache=Path(self.temp.name) / "previews")
            compute.assert_not_called()

    def test_build_promotes_exact_cached_preview_without_matching(self):
        root = Path(self.temp.name)
        cache = root / "previews"; preview = cache / "approved"; preview.mkdir(parents=True)
        sources = root / "sources.json"
        n13 = root / "n13"; n13.mkdir(); (n13 / "manifest.json").write_text("manifest")
        osm = root / "osm"; osm.mkdir()
        sources.write_text(json.dumps({"n13":{"cache":str(n13)},"osm":{"cacheDirectory":str(osm)}}))
        fingerprint = {"schemaVersion":road_ui.MATCHER.ROAD_BUILD_SCHEMA_VERSION,
                       "n13Manifest":road_ui._file_hash(n13 / "manifest.json"),
                       "osmReference":None,"osmReferenceMetadata":None}
        metadata = {"roadId":ROAD["id"],"draftHash":road_ui.draft_hash(ROAD),
                    "sourceFingerprint":fingerprint,"stage":"final",
                    "manualSelectionHash":road_ui.manual_selection_hash(None)}
        (preview / "metadata.json").write_text(json.dumps(metadata))
        exact_n13 = b'{"type":"FeatureCollection","features":[]}\n'
        artifacts = {"n13":exact_n13,"osm":b'{}\n',"report":b'{"outputs":{}}\n',"diagnostics":b'{}'}
        for name, content in artifacts.items(): (preview / f"{name}.artifact").write_bytes(content)
        registry = root / "registry.json"
        registry.write_text(json.dumps({"display":{},"roads":[ROAD]}))
        with patch.object(road_ui, "ROOT", root), \
             patch.object(road_ui.MATCHER, "compute_road_build") as compute, \
             patch.object(road_ui.MATCHER, "rebuild_search_index"):
            road_ui.build_road(ROAD["id"], "approved", ROAD, registry, sources, cache)
        compute.assert_not_called()
        self.assertEqual((root / f"public/data/roads/{ROAD['id']}-n13.geojson").read_bytes(), exact_n13)

    def test_project_crud_is_atomic_and_does_not_build_or_touch_registry(self):
        root = Path(self.temp.name); (root / "projects").mkdir()
        registry = root / "data/roads/registry.json"; registry.parent.mkdir(parents=True)
        registry.write_text('{"roads": []}')
        project = {"id":"demo", "displayName":"Demo", "bounds":[139,35,140,36], "layers":{}}
        before = registry.read_bytes()
        with patch.object(road_ui, "build_project") as build:
            road_ui.save_project(project, root=root)
            self.assertEqual(road_ui.list_projects(root), [{"id":"demo","displayName":"Demo"}])
            self.assertEqual(road_ui.load_project("demo", root)["id"], "demo")
            project["displayName"] = "Updated"; road_ui.save_project(project, "demo", root)
            self.assertEqual(road_ui.load_project("demo", root)["displayName"], "Updated")
            self.assertEqual(road_ui.list_projects(root), [{"id":"demo","displayName":"Updated"}])
            build.assert_not_called()
        self.assertEqual(registry.read_bytes(), before)
        self.assertFalse(list((root / "projects/demo").glob(".project-*")))

    def test_project_create_and_update_have_distinct_http_semantics(self):
        root = Path(self.temp.name); (root / "projects").mkdir()
        original = {"id":"demo","displayName":"Demo","bounds":[139,35,140,36],"layers":{"modernRoads":["one"]}}
        road_ui.save_project(original, root=root)
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            road_ui.save_project(original, root=root)
        updated = {**original,"displayName":"Updated","layers":{"modernRoads":["two"],"stations":{"mode":"bbox"}}}
        road_ui.save_project(updated, "demo", root)
        self.assertEqual(road_ui.load_project("demo",root), updated)
        with self.assertRaisesRegex(FileNotFoundError, "does not exist"):
            road_ui.save_project({**updated,"id":"missing"}, "missing", root)
        with self.assertRaisesRegex(ValueError, "cannot be changed"):
            road_ui.save_project({**updated,"id":"renamed"}, "demo", root)
        self.assertFalse(list((root / "projects/demo").glob(".project-*")))

    def test_delete_project_removes_only_config_and_built_project_output(self):
        root = Path(self.temp.name)
        project = {"id":"demo","displayName":"Demo","bounds":[139,35,140,36],"layers":{}}
        (root / "projects").mkdir()
        road_ui.save_project(project, root=root)
        output = root / "public/projects/demo/data"; output.mkdir(parents=True)
        (output / "modern-roads.geojson").write_text("{}")
        shared = root / "public/data/roads/shared.geojson"; shared.parent.mkdir(parents=True)
        shared.write_text("keep")
        result = road_ui.delete_project("demo", root)
        self.assertEqual(result["projectId"], "demo")
        self.assertEqual(result["deletedPaths"], ["projects/demo", "public/projects/demo"])
        self.assertFalse((root / "projects/demo").exists())
        self.assertFalse((root / "public/projects/demo").exists())
        self.assertTrue(shared.exists())
        with self.assertRaisesRegex(FileNotFoundError, "does not exist"):
            road_ui.delete_project("demo", root)
        with self.assertRaises(ValueError):
            road_ui.delete_project("../demo", root)

    def test_rejects_unsafe_project_ids(self):
        for value in ("../bad", "/bad", "bad/name", "Bad"):
            with self.assertRaises(ValueError): road_ui.validate_project_id(value)

    def test_project_catalog_status_and_routes_are_resilient(self):
        root = Path(self.temp.name); (root / "data/roads").mkdir(parents=True)
        (root / "data/roads/registry.json").write_text(json.dumps({"roads":[{"id":"built","displayName":"Built"},{"id":"missing","displayName":"Missing"}]}))
        (root / "public/data/roads").mkdir(parents=True); (root / "public/data/roads/built-n13.geojson").write_text("{}")
        missing = road_ui.project_catalog(root)
        self.assertEqual([r["built"] for r in missing["modernRoads"]], [True, False])
        self.assertFalse(missing["availability"]["codh"]["ready"]); self.assertFalse(missing["availability"]["rail"]["ready"])
        index = root / "data/cache/codh/edo-roads/index.json"; index.parent.mkdir(parents=True)
        index.write_text(json.dumps([{"id":"R003","displayName":"甲州道中","altName":"甲州街道","start":"江戸","end":"下諏訪","featureCount":1}]))
        route = road_ui.project_catalog(root)["historicalRoutes"][0]
        self.assertEqual(route["routeId"], "R003"); self.assertEqual(route["name"], "甲州道中")
        self.assertEqual(route["start"], "江戸"); self.assertEqual(route["featureCount"], 1)

    def test_delete_road_removes_only_exact_artifacts_and_preserves_references(self):
        root = Path(self.temp.name); registry = root / "data/roads/registry.json"
        registry.parent.mkdir(parents=True, exist_ok=True)
        other = {**copy.deepcopy(ROAD), "id":"tokyo-named-other", "displayName":"Other"}
        registry.write_text(json.dumps({"display":{"keep":True},"roads":[ROAD,other]}))
        project = root / "projects/demo/project.json"; project.parent.mkdir(parents=True)
        project.write_text(json.dumps({"id":"demo","displayName":"Demo","layers":{"modernRoads":[ROAD["id"]]}}))
        output = root / "public/data/roads"; output.mkdir(parents=True)
        for name in (f'{ROAD["id"]}-n13.geojson',f'{ROAD["id"]}-osm.geojson',f'{ROAD["id"]}.report.json','tokyo-named-other-n13.geojson'):
            (output/name).write_text("{}")
        reference = root / f'data/cache/osm/references/{ROAD["id"]}-osm.geojson'; reference.parent.mkdir(parents=True); reference.write_text("{}")
        for shared in ('data/cache/n13/roads/shared','data/cache/osm/rail/shared','data/cache/codh/shared'):
            path=root/shared; path.parent.mkdir(parents=True,exist_ok=True); path.write_text("keep")
        before_project=project.read_bytes(); result=road_ui.delete_road(ROAD["id"],registry,root)
        self.assertEqual(result["referencedByProjects"],[{"id":"demo","displayName":"Demo"}])
        self.assertEqual([item["id"] for item in road_ui.list_roads(registry)],[other["id"]])
        self.assertEqual(project.read_bytes(),before_project)
        self.assertFalse(reference.exists()); self.assertTrue((output/'tokyo-named-other-n13.geojson').exists())
        self.assertTrue(all((root/shared).exists() for shared in ('data/cache/n13/roads/shared','data/cache/osm/rail/shared','data/cache/codh/shared')))
        with self.assertRaises(KeyError): road_ui.delete_road(ROAD["id"],registry,root)
        road_ui.save_road(registry,ROAD); self.assertEqual(len(road_ui.list_roads(registry)),2)

    @patch.object(road_ui, "ROOT")
    def test_project_build_reuses_materializer_and_preview_returns_layers(self, _):
        root = Path(self.temp.name); (root / "scripts").mkdir()
        manifest = {"featureCounts":{"modernRoads":1},"bounds":[139,35,140,36]}
        fake = Mock(); fake.materialize_project.return_value = manifest
        with patch.dict("sys.modules", {"project_builder":fake}):
            result = road_ui.build_project("demo", root)
        fake.materialize_project.assert_called_once_with(root, "demo"); self.assertEqual(result["counts"]["modernRoads"], 1)
        output = root / "public/projects/demo/data"; output.mkdir(parents=True)
        (output.parent / "manifest.json").write_text(json.dumps(manifest))
        for name in ("modern-roads","railways","stations","historical-roads","historical-posts"):
            (output / f"{name}.geojson").write_text('{"type":"FeatureCollection","features":[]}')
        self.assertEqual(road_ui.project_preview("demo", root)["manifest"]["bounds"], [139,35,140,36])


if __name__ == "__main__":
    unittest.main()
