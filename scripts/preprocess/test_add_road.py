"""Tests for the registry road lookup script."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("add_road", Path(__file__).with_name("add-road.py"))
ADD_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADD_ROAD)


class AddRoadTests(unittest.TestCase):
    def test_builds_tokyo_ring_road_entry_and_aliases(self):
        entry = ADD_ROAD.build_entry("tokyo-prefectural-318", "東京都道318号環状七号線")
        self.assertEqual(entry["n13"], {"classification": "2"})
        self.assertEqual(entry["osm"], {"ref": "318"})
        self.assertEqual(entry["aliases"], [
            "都道318号", "東京都道318号", "環状七号線", "環七通り", "環七", "環7",
        ])

    def test_builds_national_road_entry(self):
        entry = ADD_ROAD.build_entry("jp-national-20", "国道20号")
        self.assertEqual(entry["jurisdiction"], "JP")
        self.assertEqual(entry["osm"], {"ref": "20", "network": "JP:national"})
        self.assertEqual(entry["aliases"], ["国道20", "20号"])

    def test_rejects_unknown_id_formats(self):
        with self.assertRaisesRegex(ValueError, "Unsupported road id"):
            ADD_ROAD.parse_road_id("osaka-prefectural-1")

    def test_appends_without_reordering_existing_roads(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "registry.json"
            registry.write_text(json.dumps({"display": {}, "roads": [{"id": "existing"}], "pendingRoads": []}))
            entry = ADD_ROAD.build_entry("jp-national-1", "国道1号")
            ADD_ROAD.write_registry(registry, entry)
            payload = json.loads(registry.read_text())
            self.assertEqual([road["id"] for road in payload["roads"]], ["existing", "jp-national-1"])
            with self.assertRaisesRegex(RuntimeError, "already present"):
                ADD_ROAD.write_registry(registry, entry)


if __name__ == "__main__":
    unittest.main()
