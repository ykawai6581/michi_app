#!/usr/bin/env python3
"""Launch the loopback API and isolated Vite UI together."""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    commands = [
        [sys.executable, str(ROOT / "scripts/road-ui/server.py")],
        ["npm", "--prefix", str(ROOT / "tools/road-builder"), "run", "dev"],
    ]
    processes = [subprocess.Popen(command, cwd=ROOT) for command in commands]
    try:
        while all(process.poll() is None for process in processes):
            time.sleep(.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
    failed = next((process.returncode for process in processes if process.returncode not in (None, 0, -15)), 0)
    raise SystemExit(failed)


if __name__ == "__main__":
    main()
