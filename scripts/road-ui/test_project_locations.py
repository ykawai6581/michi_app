"""Focused regression tests for project-authored locations."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import road_ui


class ProjectLocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "projects").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_save_project_accepts_locations_and_rejects_unknown_layers(self):
        project = {
            "id": "demo",
            "displayName": "Demo",
            "bounds": [139, 35, 140, 36],
            "layers": {"locations": ["shinjuku-oiwake"]},
        }
        road_ui.save_project(project, root=self.root)
        self.assertEqual(road_ui.load_project("demo", self.root)["layers"]["locations"], ["shinjuku-oiwake"])

        with self.assertRaisesRegex(ValueError, "unsupported layer"):
            road_ui.save_project({**project, "id": "bad", "layers": {"notARealLayer": []}}, root=self.root)

    def test_project_preview_includes_locations_collection(self):
        output = self.root / "public/projects/demo"
        data = output / "data"
        data.mkdir(parents=True)
        (output / "manifest.json").write_text(json.dumps({"projectId": "demo"}), encoding="utf-8")

        empty = {"type": "FeatureCollection", "features": []}
        names = {
            "modern-roads": empty,
            "railways": empty,
            "stations": empty,
            "historical-roads": empty,
            "historical-posts": empty,
            "locations": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {"id": "location:shinjuku-oiwake", "name": "新宿追分"},
                    "geometry": {"type": "Point", "coordinates": [139.704, 35.69]},
                }],
            },
        }
        for name, document in names.items():
            (data / f"{name}.geojson").write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")

        preview = road_ui.project_preview("demo", self.root)
        self.assertIn("locations", preview["layers"])
        self.assertEqual(preview["layers"]["locations"]["features"][0]["properties"]["name"], "新宿追分")


if __name__ == "__main__":
    unittest.main()
