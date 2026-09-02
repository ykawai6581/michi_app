# Codex project instructions

## Environment

The Codex Cloud environment for this repository is already configured by the
environment setup script.

Python GIS dependencies from `requirements-preprocess.txt` are preinstalled,
including GeoPandas, Shapely, PyArrow, and Pyogrio.

Root npm dependencies and `tools/road-builder` npm dependencies are also
preinstalled.

Do NOT install, upgrade, downgrade, or repair dependencies during normal Codex
tasks.

Do NOT run:

- `pip install`
- `python -m pip install`
- `npm install`
- `npm ci`
- `apt install`
- `apt-get install`
- package-manager upgrade commands

unless the user explicitly asks to change the dependency environment.

If an expected dependency cannot be imported:

1. stop that validation step immediately;
2. report the missing dependency and exact import error;
3. do NOT attempt to install or repair it.

## Python GIS validation

For changes involving N13 matching, topology, road connectivity, or GIS code,
run the smallest relevant GeoPandas test first.

For example:

```bash
python -m unittest \
  scripts.preprocess.test_match_road.StableIdentityAndManualSelectionTests
