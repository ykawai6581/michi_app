"""Register a canonical road, then build its matched display geometry."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Callable


REGISTRY = Path("data/roads/registry.json")
N13_INPUT = Path("data/cache/n13/roads")
SCRIPT_DIRECTORY = Path(__file__).resolve().parent


def road_is_registered(registry_path: Path, road_id: str) -> bool:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    return any(road.get("id") == road_id for road in registry.get("roads", []))


def commands_for(args: argparse.Namespace) -> list[list[str]]:
    """Build commands in execution order, skipping registration when unnecessary."""
    commands = []
    if not road_is_registered(args.registry, args.road_id):
        commands.append([
            sys.executable, str(SCRIPT_DIRECTORY / "add-road.py"), args.road_id,
            "--registry", str(args.registry),
        ])

    match = [
        sys.executable, str(SCRIPT_DIRECTORY / "match-road.py"), args.road_id,
        "--registry", str(args.registry), "--n13", str(args.n13),
    ]
    if args.refresh_osm:
        match.append("--refresh-osm")
    if args.overpass_url:
        match.extend(["--overpass-url", args.overpass_url])
    commands.append(match)
    return commands


def run_pipeline(args: argparse.Namespace, runner: Callable = subprocess.run) -> None:
    commands = commands_for(args)
    if len(commands) == 1:
        print(f"{args.road_id} is already registered; proceeding directly to geometry matching.")
    for command in commands:
        print("+", " ".join(command), flush=True)
        runner(command, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("road_id", help="canonical id, for example tokyo-prefectural-318")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--n13", type=Path, default=N13_INPUT)
    parser.add_argument("--refresh-osm", action="store_true")
    parser.add_argument("--overpass-url", help="override match-road.py's Overpass endpoint")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        run_pipeline(args)
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"build-road: error: {error}") from None
    except subprocess.CalledProcessError as error:
        script = Path(error.cmd[1]).name if len(error.cmd) > 1 else str(error.cmd[0])
        raise SystemExit(
            f"build-road: {script} failed for {args.road_id!r} with exit status {error.returncode}; "
            "the pipeline has stopped."
        ) from None


if __name__ == "__main__":
    main()
