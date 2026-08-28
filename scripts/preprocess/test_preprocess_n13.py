"""Tests for regional N13 cache preprocessing."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
import geopandas as gpd
from shapely.geometry import LineString

SPEC = importlib.util.spec_from_file_location("preprocess_n13", Path(__file__).with_name("preprocess-n13.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class PreprocessN13Tests(unittest.TestCase):
    def test_keeps_road_classes_one_through_three(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.geojson", Path(directory) / "roads.parquet"
            gpd.GeoDataFrame({"N13_003": ["1", "2", "3", "4"], "geometry": [
                LineString([(i, 0), (i, 1)]) for i in range(4)]}, crs="EPSG:4326").to_file(source, driver="GeoJSON")
            report = MODULE.preprocess_n13(source, output, chunk_size=2)
            self.assertEqual(set(gpd.read_parquet(output)["N13_003"]), {"1", "2", "3"})
            self.assertEqual(report["sourceFeatureCount"], 4)

if __name__ == "__main__":
    unittest.main()
