"""Tests for the combined road registration and matching command."""

import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock


SPEC = importlib.util.spec_from_file_location("build_road", Path(__file__).with_name("build-road.py"))
BUILD_ROAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD_ROAD)


def arguments(registry: Path, **overrides) -> argparse.Namespace:
    values = {
        "road_id": "tokyo-prefectural-319", "registry": registry,
        "n13": Path("fixture.geojson"), "refresh_osm": False, "overpass_url": None,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


class BuildRoadTests(unittest.TestCase):
    def make_registry(self, roads) -> tuple[tempfile.TemporaryDirectory, Path]:
        directory = tempfile.TemporaryDirectory()
        registry = Path(directory.name) / "registry.json"
        registry.write_text(json.dumps({"roads": roads}), encoding="utf-8")
        return directory, registry

    def test_new_road_is_added_before_it_is_matched(self):
        directory, registry = self.make_registry([])
        self.addCleanup(directory.cleanup)
        commands = BUILD_ROAD.commands_for(arguments(registry))
        self.assertEqual(Path(commands[0][1]).name, "add-road.py")
        self.assertEqual(Path(commands[1][1]).name, "match-road.py")
        self.assertEqual(commands[0][2], commands[1][2])

    def test_registered_road_goes_directly_to_matching(self):
        directory, registry = self.make_registry([{"id": "tokyo-prefectural-319"}])
        self.addCleanup(directory.cleanup)
        commands = BUILD_ROAD.commands_for(arguments(registry))
        self.assertEqual(len(commands), 1)
        self.assertEqual(Path(commands[0][1]).name, "match-road.py")

    def test_match_options_are_forwarded_and_failures_stop_pipeline(self):
        directory, registry = self.make_registry([])
        self.addCleanup(directory.cleanup)
        args = arguments(registry, refresh_osm=True, overpass_url="https://overpass.test/api")
        runner = Mock(side_effect=[None, subprocess_error()])
        with self.assertRaises(RuntimeError):
            BUILD_ROAD.run_pipeline(args, runner=runner)
        self.assertEqual(runner.call_count, 2)
        match_command = runner.call_args_list[1].args[0]
        self.assertIn("--refresh-osm", match_command)
        self.assertEqual(match_command[-2:], ["--overpass-url", "https://overpass.test/api"])


def subprocess_error() -> RuntimeError:
    return RuntimeError("matching failed")


if __name__ == "__main__":
    unittest.main()
