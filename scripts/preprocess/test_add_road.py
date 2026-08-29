"""Tests for the registry road lookup script."""

import importlib.util
import json
import sys
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
        self.assertEqual(entry["entityType"], "statutory-road")
        self.assertEqual(entry["n13"], {"classifications": ["2"]})
        self.assertEqual(entry["reference"], {"type": "osm-ref", "ref": "318"})
        self.assertEqual(entry["aliases"], [
            "都道318号", "東京都道318号", "環状七号線", "環七通り", "環七", "環7",
        ])

    def test_builds_national_road_entry(self):
        entry = ADD_ROAD.build_entry("jp-national-20", "国道20号")
        self.assertEqual(entry["jurisdiction"], "JP")
        self.assertEqual(entry["reference"], {"type": "osm-ref", "ref": "20", "network": "JP:national"})
        self.assertEqual(entry["aliases"], ["国道20", "20号"])

    def test_builds_named_road_with_one_name(self):
        entry = ADD_ROAD.build_named_entry(
            "tokyo-named-shinjuku-dori", "新宿通り", ["新宿通り"], [], ["1"])
        self.assertEqual(entry["entityType"], "named-road")
        self.assertEqual(entry["reference"], {
            "type": "osm-name", "names": ["新宿通り"],
            "tags": ["name", "name:ja", "alt_name"],
        })
        self.assertEqual(entry["n13"], {"classifications": ["1"]})

    def test_named_road_deduplicates_names_aliases_and_multiple_classes(self):
        entry = ADD_ROAD.build_named_entry(
            "tokyo-named-inokashira-dori", "井の頭通り",
            ["井ノ頭通り", "井の頭通り", "井ノ頭通り"],
            ["井ノ頭通り", "井ノ頭通り"], ["2", "3", "2"])
        self.assertEqual(entry["reference"]["names"], ["井ノ頭通り", "井の頭通り"])
        self.assertEqual(entry["aliases"], ["井ノ頭通り"])
        self.assertEqual(entry["n13"]["classifications"], ["2", "3"])

    def test_named_road_defaults_osm_name_to_display_name(self):
        entry = ADD_ROAD.build_named_entry(
            "tokyo-named-shinjuku-dori", "新宿通り", [], [], ["1"])
        self.assertEqual(entry["reference"]["names"], ["新宿通り"])

    def test_named_road_requires_display_name_and_n13_classes(self):
        with self.assertRaisesRegex(ValueError, "--display-name is required"):
            ADD_ROAD.build_named_entry("tokyo-named-test", None, [], [], ["1"])
        with self.assertRaisesRegex(ValueError, "--n13-classes is required"):
            ADD_ROAD.build_named_entry("tokyo-named-test", "テスト通り", [], [], None)
        with self.assertRaisesRegex(ValueError, "unsupported"):
            ADD_ROAD.build_named_entry("tokyo-named-test", "テスト通り", [], [], ["4"])

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

    def test_dry_run_rejects_duplicates_and_does_not_edit_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "registry.json"
            original = json.dumps({"roads": []})
            registry.write_text(original, encoding="utf-8")
            argv = ["add-road.py", "tokyo-named-test-dori", "--registry", str(registry),
                    "--display-name", "テスト通り", "--osm-name", "テスト通り",
                    "--n13-classes", "2", "3", "--dry-run"]
            with patch.object(sys, "argv", argv), patch("builtins.print"):
                ADD_ROAD.main()
            self.assertEqual(registry.read_text(encoding="utf-8"), original)
            registry.write_text(json.dumps({"roads": [{"id": "tokyo-named-test-dori"}]}))
            with patch.object(sys, "argv", argv), self.assertRaises(SystemExit) as error:
                ADD_ROAD.main()
            self.assertEqual(error.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
