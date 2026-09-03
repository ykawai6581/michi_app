import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
from shapely.geometry import LineString, Point

from project_builder import ProjectBuildError, load_project_config, load_rail_colors, materialize_project, normalize_rail_alias, rail_group_properties, resolve_rail_color, resolve_project_bounds, select_bbox_features, select_modern_roads, select_routes

class ProjectBuilderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / "projects/demo").mkdir(parents=True); (self.root / "data/roads").mkdir(parents=True); (self.root / "public/data/roads").mkdir(parents=True)
        (self.root / "data/sources").mkdir(parents=True); (self.root / "data/sources/railcolors.json").write_text((Path(__file__).parents[1]/"data/sources/railcolors.json").read_text(encoding="utf-8"),encoding="utf-8")
        self.config = {"id":"demo","displayName":"Demo","bounds":[139.0,35.0,140.0,36.0],"layers":{"modernRoads":["road-a"],"railways":{"mode":"bbox"},"stations":{"mode":"bbox"},"historicalRoads":["R003"],"historicalPosts":["R003"]}}
        self.write_config(self.config)
        (self.root / "data/roads/registry.json").write_text(json.dumps({"roads":[{"id":"road-a","displayName":"Road A","aliases":["A"]},{"id":"road-b","displayName":"Road B","aliases":[]}]}))
        (self.root / "public/data/roads/road-a-n13.geojson").write_text(json.dumps({"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[139.1,35.1],[139.2,35.2]]}}]}))
        (self.root / "public/data/roads/road-b-n13.geojson").write_text(json.dumps({"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[139.7,35.4],[139.8,35.5]]}}]}))
        self.write_parquet("data/cache/osm/rail/tracks.parquet", [{"osm_element_id":"1","name:ja":"中央本線","operator":"JR東日本"},{"osm_element_id":"2","name:ja":"中央本線","operator":"JR東日本"},{"osm_element_id":"3","name:ja":"別線","operator":"別会社"}], [LineString([(139.1,35.1),(139.2,35.2)]),LineString([(139.1,35.11),(139.2,35.21)]),LineString([(141,37),(142,38)])])
        self.write_parquet("data/cache/osm/rail/routes.parquet", [{"railRouteId":"osm-railway-relation:100","name:ja":"中央本線","identitySource":"route-relation"},{"railRouteId":"osm-railway-relation:200","name:ja":"遠方線","identitySource":"route-relation"}], [LineString([(139.11,35.1),(145,40)]),LineString([(150,45),(151,46)])])
        self.write_parquet("data/cache/osm/rail/route-members.parquet", [{"railRouteId":"osm-railway-relation:100","osm_way_id":"1","memberOrder":0,"memberRole":""},{"railRouteId":"osm-railway-relation:100","osm_way_id":"2","memberOrder":1,"memberRole":""}], [LineString([(139.1,35.1),(139.2,35.2)]),LineString([(139.1,35.11),(139.2,35.21)])])
        self.write_parquet("data/cache/osm/rail/stations.parquet", [{"osm_element_id":"10","name":"Demo Station"},{"osm_element_id":"11","name":"Far"}], [Point(139.3,35.3),Point(141,37)])
        roads=[{"routeId":"R003","name":"甲州道中","altName":"甲州街道","start":"江戸","end":"下諏訪","entityType":"historical-road"},{"routeId":"R004","name":"Other","entityType":"historical-road"}]
        self.write_parquet("data/cache/codh/edo-roads/roads.parquet", roads, [LineString([(139.1,35.1),(139.5,35.5)]),LineString([(130,30),(131,31)])])
        posts=[{"routeId":"R003","postId":"R003-001","name":"内藤新宿","historicalLabel":"内藤新宿（ないとうしんじゅく）","historicalPlaceId":"shared","entityType":"historical-post"},{"routeId":"R003","postId":"R003-002","name":"下高井戸","historicalPlaceId":"shared","entityType":"historical-post"}]
        self.write_parquet("data/cache/codh/edo-posts/posts.parquet", posts, [Point(139.2,35.2),Point(139.3,35.3)])
    def tearDown(self): self.temp.cleanup()
    def write_config(self, value): (self.root / "projects/demo/project.json").write_text(json.dumps(value))
    def write_parquet(self, relative, properties, geometry):
        path=self.root/relative; path.parent.mkdir(parents=True,exist_ok=True); gpd.GeoDataFrame(properties,geometry=geometry,crs="EPSG:4326").to_parquet(path)
    def test_load_valid_project_config(self): self.assertEqual(load_project_config(self.root,"demo")["id"],"demo")
    def test_old_config_defaults_without_jurisdiction_and_new_state_is_preserved(self):
        self.assertNotIn("jurisdictionLayer",load_project_config(self.root,"demo"))
        configured={**self.config,"jurisdictionLayer":{"enabled":True,"provider":"geoshape","prefecture":"13","snapshotDate":"1932-12-31","selection":{"level":"parent","value":"東京市"}}}
        self.write_config(configured)
        self.assertEqual(load_project_config(self.root,"demo")["jurisdictionLayer"],configured["jurisdictionLayer"])
    def test_reject_malformed_bounds(self):
        bad={**self.config,"bounds":[140,35,139,36]}; self.write_config(bad)
        with self.assertRaisesRegex(ProjectBuildError,"Malformed bounds"): load_project_config(self.root,"demo")
    def test_explicit_bounds_resolve_unchanged_and_override_auto(self):
        roads=select_modern_roads(self.root,["road-a"]); bounds,source=resolve_project_bounds(self.config,roads)
        self.assertEqual(bounds,self.config["bounds"]); self.assertEqual(source,{"mode":"explicit"})
    def test_omitted_bounds_derive_with_default_padding(self):
        config={key:value for key,value in self.config.items() if key != "bounds"}; self.write_config(config)
        loaded=load_project_config(self.root,"demo"); bounds,source=resolve_project_bounds(loaded,select_modern_roads(self.root,["road-a"]))
        self.assertEqual(source["paddingKm"],3); self.assertLess(bounds[0],139.1); self.assertGreater(bounds[2],139.2)
    def test_explicit_auto_bounds_contain_and_pad_road(self):
        config={**self.config,"bounds":{"mode":"auto","from":"modernRoads","paddingKm":1}}
        bounds,source=resolve_project_bounds(config,select_modern_roads(self.root,["road-a"]))
        self.assertEqual(source["roadIds"],["road-a"]); self.assertLess(bounds[0],139.1); self.assertLess(bounds[1],35.1); self.assertGreater(bounds[2],139.2); self.assertGreater(bounds[3],35.2)
    def test_multiple_roads_produce_combined_bounds(self):
        config={**self.config,"bounds":{"mode":"auto","from":"modernRoads","paddingKm":1},"layers":{**self.config["layers"],"modernRoads":["road-a","road-b"]}}
        bounds,_=resolve_project_bounds(config,select_modern_roads(self.root,["road-a","road-b"]))
        self.assertLess(bounds[0],139.1); self.assertGreater(bounds[2],139.8)
    def test_auto_padding_must_be_positive(self):
        self.write_config({**self.config,"bounds":{"mode":"auto","from":"modernRoads","paddingKm":0}})
        with self.assertRaisesRegex(ProjectBuildError,"positive"): load_project_config(self.root,"demo")
    def test_unsupported_auto_source(self):
        self.write_config({**self.config,"bounds":{"mode":"auto","from":"historicalRoads","paddingKm":3}})
        with self.assertRaisesRegex(ProjectBuildError,"only accepts 'modernRoads'"): load_project_config(self.root,"demo")
    def test_auto_without_modern_roads(self):
        config={**self.config,"bounds":{"mode":"auto","from":"modernRoads","paddingKm":3},"layers":{**self.config["layers"],"modernRoads":[]}}
        with self.assertRaisesRegex(ProjectBuildError,"no modernRoads"): resolve_project_bounds(config,[])
    def test_select_modern_road_by_id(self): self.assertEqual(select_modern_roads(self.root,["road-a"])[0]["properties"]["name"],"Road A")
    def test_missing_modern_road(self):
        with self.assertRaisesRegex(ProjectBuildError,"build-road.py"): select_modern_roads(self.root,["absent"])
    def test_empty_modern_road_geometry(self):
        (self.root/"public/data/roads/road-a-n13.geojson").write_text(json.dumps({"type":"FeatureCollection","features":[]}))
        with self.assertRaisesRegex(ProjectBuildError,"contains no geometry.*build-road.py"): select_modern_roads(self.root,["road-a"])
    def test_bbox_tracks_and_parallel_preserved(self): self.assertEqual(len(select_bbox_features(self.root/"data/cache/osm/rail/tracks.parquet",self.config["bounds"])),2)
    def test_rail_grouping_is_exact_and_conservative(self):
        first=rail_group_properties({"name:ja":"中央本線","operator":"JR東日本"})
        self.assertEqual(first,rail_group_properties({"name:ja":"中央本線","operator":"JR東日本"}))
        self.assertNotEqual(first,rail_group_properties({"name:ja":"中央本線","operator":"別会社"}))
        self.assertIsNone(rail_group_properties({"railway":"rail"}))
        self.assertTrue(rail_group_properties({"wikidata":"Q123"})["railGroupId"].endswith("Q123"))
    def test_rail_color_aliases_normalization_ambiguity_and_fallback(self):
        colors=load_rail_colors(self.root)
        expected={"JR 中央線快速":"#FF4500","JR 中央・総武緩行線":"#FFD700","JR 山手線":"#9ACD32","京王 京王線":"#E3379F","京王 井の頭線":"#1A407B","小田急 小田原線":"#2683CE","西武 新宿線":"#00A6BF","東急 東横線":"#DA0042"}
        for alias,color in expected.items(): self.assertEqual(resolve_rail_color({"railDisplayName":alias},colors)[0],color)
        self.assertEqual(resolve_rail_color({"railDisplayName":"  JR\u3000中央線快速  "},colors),("#FF4500","jr-chuo-rapid"))
        self.assertEqual(normalize_rail_alias(" ＪＲ   CHUO "),"jr chuo")
        self.assertEqual(resolve_rail_color({"railDisplayName":"新宿線"},colors),(colors["fallbackColor"],None))
        self.assertEqual(resolve_rail_color({"railDisplayName":"未知線","operator":"西武"},colors),(colors["fallbackColor"],None))
    def test_bbox_stations(self): self.assertEqual(len(select_bbox_features(self.root/"data/cache/osm/rail/stations.parquet",self.config["bounds"])),1)
    def test_select_historical_road(self): self.assertEqual(len(select_routes(self.root/"data/cache/codh/edo-roads/roads.parquet",["R003"],"historicalRoads")),1)
    def test_select_distinct_posts_with_shared_place_id(self): self.assertEqual(len(select_routes(self.root/"data/cache/codh/edo-posts/posts.parquet",["R003"],"historicalPosts")),2)
    def test_search_and_manifest_counts(self):
        output=self.root/"output"; manifest=materialize_project(self.root,"demo",output)
        entities=json.loads((output/"search/entities.json").read_text()); self.assertEqual({e["entityType"] for e in entities},{"modern-road","railway","railway-station","historical-road","historical-post"})
        rail=[entity for entity in entities if entity["entityType"]=="railway"]
        self.assertEqual(len(rail),1); self.assertEqual(rail[0]["displayName"],"中央本線"); self.assertEqual(rail[0]["identitySource"],"route-relation")
        for key,path in manifest["outputs"].items():
            if key == "search": continue
            count=len(json.loads((output/path).read_text())["features"])
            manifest_key={"railways":"railwayTracks","historicalRoads":"historicalRoadFeatures"}.get(key,key)
            self.assertEqual(count,manifest["featureCounts"][manifest_key])
        self.assertEqual(manifest["bounds"],self.config["bounds"]); self.assertEqual(manifest["boundsSource"],{"mode":"explicit"})
        self.assertEqual(manifest["featureCounts"]["railwayRoutes"],1)

    def test_near_road_selects_full_unclipped_route(self):
        self.write_config({**self.config,"layers":{**self.config["layers"],"railways":{"mode":"near-modern-roads","distanceKm":3}}})
        output=self.root/"near"; manifest=materialize_project(self.root,"demo",output)
        routes=json.loads((output/"data/railway-routes.geojson").read_text())["features"]
        self.assertEqual([r["properties"]["name:ja"] for r in routes],["中央本線"])
        self.assertEqual(routes[0]["geometry"]["coordinates"][-1],[145.0,40.0])
        self.assertEqual(manifest["railwaySelection"],{"mode":"near-modern-roads","distanceKm":3})
    def test_auto_manifest_and_bbox_layers_use_resolved_bounds(self):
        config={**self.config,"bounds":{"mode":"auto","from":"modernRoads","paddingKm":3}}; self.write_config(config)
        manifest=materialize_project(self.root,"demo",self.root/"auto-output")
        self.assertEqual(manifest["boundsSource"],{"mode":"auto","from":"modernRoads","paddingKm":3,"roadIds":["road-a"]})
        self.assertLess(manifest["bounds"][0],139.1); self.assertGreater(manifest["bounds"][2],139.2)
        self.assertEqual(manifest["featureCounts"]["railwayTracks"],2)
        # Route selectors remain complete and are not clipped to the derived bbox.
        self.assertEqual(manifest["featureCounts"]["historicalRoadFeatures"],1); self.assertEqual(manifest["featureCounts"]["historicalPosts"],2)
    def test_rebuild_replaces_removed_layer_with_empty_browser_data(self):
        output=self.root/"replace-output"; materialize_project(self.root,"demo",output)
        self.assertEqual(len(json.loads((output/"data/railways.geojson").read_text())["features"]),2)
        updated={**self.config,"layers":{key:value for key,value in self.config["layers"].items() if key!="railways"}}
        self.write_config(updated); manifest=materialize_project(self.root,"demo",output)
        self.assertEqual(json.loads((output/"data/railways.geojson").read_text())["features"],[])
        self.assertEqual(manifest["featureCounts"]["railwayTracks"],0)
    def test_unsupported_family(self):
        self.write_config({**self.config,"layers":{**self.config["layers"],"coastline":[]}})
        with self.assertRaisesRegex(ProjectBuildError,"Unsupported layer family"): load_project_config(self.root,"demo")
    def test_missing_cache_actionable(self):
        (self.root/"data/cache/osm/rail/tracks.parquet").unlink()
        with self.assertRaisesRegex(ProjectBuildError,"preprocess-rail.py"): materialize_project(self.root,"demo",self.root/"output")

if __name__ == "__main__": unittest.main()
