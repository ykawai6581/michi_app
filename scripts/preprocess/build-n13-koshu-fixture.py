"""Backward-compatible entry point; new roads use match-road.py + registry data."""

import runpy
import sys
from pathlib import Path

sys.argv = [sys.argv[0], "jp-national-20", *sys.argv[1:]]
runpy.run_path(Path(__file__).with_name("match-road.py"), run_name="__main__")
