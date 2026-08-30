import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
from shapely.geometry import LineString, Point

from project_builder import ProjectBuildError, build_search, load_project_config, materialize_project, select_bbox_features, select_modern_roads, select_routes

class ProjectBuilderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / "projects/demo").mkdir(parents=True); (self.root / "data/roads").mkdir(parents=True); (self.root / "public/data/roads").mkdir(parents=True)
        self.config = {"id":"demo","displayName":"Demo","bounds":[139.0,35.0,140.0,36.0],"layers":{"modernRoads":["road-a"],"railways":{"mode":"bbox"},"stations":{"mode":"bbox"},"historicalRoads":["R003"],"historicalPosts":["R003"]}}
        self.write_config(self.config)
        (self.root / "data/roads/registry.json").write_text(json.dumps({"roads":[{"id":"road-a","displayName":"Road A","aliases":["A"]}]}))
        (self.root / "public/data/roads/road-a-n13.geojson").write_text(json.dumps({"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[139.1,35.1],[139.2,35.2]]}}]}))
        self.write_parquet("data/cache/osm/rail/tracks.parquet", [{"osm_element_id":"1"},{"osm_element_id":"2"},{"osm_element_id":"3"}], [LineString([(139.1,35.1),(139.2,35.2)]),LineString([(139.1,35.11),(139.2,35.21)]),LineString([(141,37),(142,38)])])
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
    def test_reject_malformed_bounds(self):
        bad={**self.config,"bounds":[140,35,139,36]}; self.write_config(bad)
        with self.assertRaisesRegex(ProjectBuildError,"Malformed bounds"): load_project_config(self.root,"demo")
    def test_select_modern_road_by_id(self): self.assertEqual(select_modern_roads(self.root,["road-a"])[0]["properties"]["name"],"Road A")
    def test_missing_modern_road(self):
        with self.assertRaisesRegex(ProjectBuildError,"build-road.py"): select_modern_roads(self.root,["absent"])
    def test_bbox_tracks_and_parallel_preserved(self): self.assertEqual(len(select_bbox_features(self.root/"data/cache/osm/rail/tracks.parquet",self.config["bounds"])),2)
    def test_bbox_stations(self): self.assertEqual(len(select_bbox_features(self.root/"data/cache/osm/rail/stations.parquet",self.config["bounds"])),1)
    def test_select_historical_road(self): self.assertEqual(len(select_routes(self.root/"data/cache/codh/edo-roads/roads.parquet",["R003"],"historicalRoads")),1)
    def test_select_distinct_posts_with_shared_place_id(self): self.assertEqual(len(select_routes(self.root/"data/cache/codh/edo-posts/posts.parquet",["R003"],"historicalPosts")),2)
    def test_search_and_manifest_counts(self):
        output=self.root/"output"; manifest=materialize_project(self.root,"demo",output)
        entities=json.loads((output/"search/entities.json").read_text()); self.assertEqual({e["entityType"] for e in entities},{"modern-road","railway-station","historical-road","historical-post"})
        for key,path in manifest["outputs"].items():
            if key == "search": continue
            count=len(json.loads((output/path).read_text())["features"])
            manifest_key={"railways":"railwayTracks","historicalRoads":"historicalRoadFeatures"}.get(key,key)
            self.assertEqual(count,manifest["featureCounts"][manifest_key])
    def test_unsupported_family(self):
        self.write_config({**self.config,"layers":{**self.config["layers"],"coastline":[]}})
        with self.assertRaisesRegex(ProjectBuildError,"Unsupported layer family"): load_project_config(self.root,"demo")
    def test_missing_cache_actionable(self):
        (self.root/"data/cache/osm/rail/tracks.parquet").unlink()
        with self.assertRaisesRegex(ProjectBuildError,"preprocess-rail.py"): materialize_project(self.root,"demo",self.root/"output")

if __name__ == "__main__": unittest.main()
