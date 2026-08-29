"""Tests for regional N13 cache preprocessing."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import geopandas as gpd
from shapely.geometry import LineString

SPEC = importlib.util.spec_from_file_location("preprocess_n13", Path(__file__).with_name("preprocess-n13.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class PreprocessN13Tests(unittest.TestCase):
    def make_source(self, directory):
        source = Path(directory) / "source.geojson"
        gpd.GeoDataFrame({"N13_003": ["1", "2", "3", "4"], "geometry": [
            LineString([(i, 0), (i, 1)]) for i in range(4)]}, crs="EPSG:4326").to_file(source, driver="GeoJSON")
        return source

    def test_default_cache_partitions_major_road_classes_only(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = self.make_source(directory), Path(directory) / "roads"
            report = MODULE.preprocess_n13(source, output, chunk_size=2)
            self.assertEqual(set(report["outputs"]), {"1", "2"})
            self.assertFalse((output / "class=3").exists())
            self.assertEqual(set(gpd.read_parquet(output / "class=1/roads.parquet")["N13_003"]), {"1"})
            self.assertEqual(report["sourceFeatureCount"], 4)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(manifest["boundsWgs84"], [0.0, 0.0, 3.0, 1.0])
            self.assertEqual(manifest["sourceFeatureCount"], 4)
            self.assertEqual(manifest["sourceCrs"], "EPSG:4326")
            self.assertEqual(manifest["availableClasses"], ["1", "2"])
            self.assertTrue({"bbox_west", "bbox_south", "bbox_east", "bbox_north"}.issubset(
                gpd.read_parquet(output / "class=1/roads.parquet").columns))

    def test_class_three_can_be_built_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = self.make_source(directory), Path(directory) / "roads"
            report = MODULE.preprocess_n13(source, output, classes={"3"}, chunk_size=2)
            self.assertEqual(report["classes"], ["3"])
            self.assertEqual(set(gpd.read_parquet(output / "class=3/roads.parquet")["N13_003"]), {"3"})

    def test_later_class_three_run_preserves_existing_partition_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = self.make_source(directory), Path(directory) / "roads"
            MODULE.preprocess_n13(source, output, classes={"1", "2"}, chunk_size=2)
            MODULE.preprocess_n13(source, output, classes={"3"}, chunk_size=2)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(manifest["availableClasses"], ["1", "2", "3"])
            self.assertEqual(set(manifest["partitions"]), {"1", "2", "3"})

    def test_legacy_parquet_output_name_is_normalized_to_partition_root(self):
        with tempfile.TemporaryDirectory() as directory:
            source, requested = self.make_source(directory), Path(directory) / "roads.parquet"
            # An old single-file cache can coexist while the new cache is written to roads/.
            requested.write_text("old cache")
            report = MODULE.preprocess_n13(source, requested, chunk_size=2)
            self.assertEqual(Path(report["cacheRoot"]), Path(directory) / "roads")
            self.assertTrue((Path(directory) / "roads/class=1/roads.parquet").is_file())

if __name__ == "__main__":
    unittest.main()
