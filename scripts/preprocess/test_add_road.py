"""Tests for the registry road lookup script."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location("add_road", Path(__file__).with_name("add-road.py"))
ADD_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADD_ROAD)


class AddRoadTests(unittest.TestCase):
    @staticmethod
    def api_response(titles):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({
            "query": {"search": [{"title": title} for title in titles]}
        }).encode()
        return response

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

    def test_builds_shared_prefecture_road_entry(self):
        entry = ADD_ROAD.build_entry("tokyo-prefectural-25", "東京都道・埼玉県道25号飯田橋石神井新座線")
        self.assertEqual(entry["displayName"], "東京都道・埼玉県道25号飯田橋石神井新座線")
        self.assertIn("飯田橋石神井新座線", entry["aliases"])

    def test_shared_prefecture_title_matches_only_requested_number(self):
        self.assertTrue(ADD_ROAD.title_matches("東京都道・埼玉県道25号飯田橋石神井新座線", "東京都道", "25"))
        self.assertFalse(ADD_ROAD.title_matches("東京都道・埼玉県道24号練馬所沢線", "東京都道", "25"))

    def test_wikipedia_search_retries_with_shared_route_query(self):
        responses = [self.api_response([]), self.api_response([
            "東京都道・埼玉県道24号練馬所沢線",
            "東京都道・埼玉県道25号飯田橋石神井新座線",
        ])]
        with patch.object(ADD_ROAD, "urlopen", side_effect=responses) as urlopen:
            title = ADD_ROAD.wikipedia_search("東京都道", "25")
        self.assertEqual(title, "東京都道・埼玉県道25号飯田橋石神井新座線")
        self.assertEqual(urlopen.call_count, 2)

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
