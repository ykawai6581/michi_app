"""Look up a canonical road name and add it to the road registry."""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REGISTRY = Path("data/roads/registry.json")
WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php"
MATCHING_DEFAULTS = {
    "sampleIntervalMeters": 5,
    "maximumMedianResidualMeters": 20,
    "maximumP90ResidualMeters": 25,
    "coverageToleranceMeters": 25,
}
ROAD_KINDS = {
    "jp-national": {
        "roadClass": "national", "jurisdiction": "JP", "namePrefix": "国道",
        "shortPrefix": "国道", "n13Classification": "1", "osmNetwork": "JP:national",
    },
    "tokyo-prefectural": {
        "roadClass": "prefectural", "jurisdiction": "Tokyo", "namePrefix": "東京都道",
        "shortPrefix": "都道", "n13Classification": "2",
    },
}


def parse_road_id(road_id: str) -> tuple[dict, str]:
    """Return the registry template and route number represented by an id."""
    match = re.fullmatch(r"([a-z]+-(?:national|prefectural))-(\d+)", road_id)
    if not match or match.group(1) not in ROAD_KINDS:
        supported = ", ".join(f"{kind}-NUMBER" for kind in ROAD_KINDS)
        raise ValueError(f"Unsupported road id {road_id!r}; expected one of: {supported}")
    return ROAD_KINDS[match.group(1)], match.group(2)


def wikipedia_search(query: str, endpoint: str = WIKIPEDIA_API) -> str:
    """Find the Japanese Wikipedia title whose canonical prefix matches query."""
    parameters = urlencode({
        "action": "query", "format": "json", "formatversion": "2", "list": "search",
        "srsearch": f'intitle:"{query}"', "srnamespace": "0", "srlimit": "10",
    })
    request = Request(f"{endpoint}?{parameters}", headers={
        "Accept": "application/json", "User-Agent": "michi-map-registry-builder/0.1",
    })
    with urlopen(request, timeout=30) as response:  # noqa: S310
        results = json.load(response).get("query", {}).get("search", [])
    titles = [item["title"] for item in results if item.get("title", "").startswith(query)]
    if not titles:
        raise RuntimeError(f"Japanese Wikipedia returned no canonical road title beginning with {query!r}")
    return min(titles, key=lambda title: (len(title), title))


def aliases_for(title: str, config: dict, number: str) -> list[str]:
    if config["roadClass"] == "national":
        aliases = [f"国道{number}", f"{number}号"]
    else:
        aliases = [f"{config['shortPrefix']}{number}号", f"{config['namePrefix']}{number}号"]
    suffix = title.removeprefix(f"{config['namePrefix']}{number}号")
    if suffix:
        aliases.append(suffix)
        ring = re.fullmatch(r"環状([一二三四五六七八九十]+)号線", suffix)
        if ring:
            japanese = ring.group(1)
            digits = str({"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
                          "七": 7, "八": 8, "九": 9, "十": 10}.get(japanese, japanese))
            aliases.extend([f"環{japanese}通り", f"環{japanese}", f"環{digits}"])
    return list(dict.fromkeys(alias for alias in aliases if alias != title))


def build_entry(road_id: str, title: str) -> dict:
    config, number = parse_road_id(road_id)
    expected = f"{config['namePrefix']}{number}号"
    if not title.startswith(expected):
        raise RuntimeError(f"Search result {title!r} does not describe {road_id!r} (expected {expected!r})")
    osm = {"ref": number}
    if config.get("osmNetwork"):
        osm["network"] = config["osmNetwork"]
    return {
        "id": road_id, "displayName": title, "roadClass": config["roadClass"],
        "routeNumber": number, "jurisdiction": config["jurisdiction"],
        "aliases": aliases_for(title, config, number),
        "n13": {"classification": config["n13Classification"]}, "osm": osm,
        "matching": MATCHING_DEFAULTS.copy(),
    }


def write_registry(path: Path, entry: dict) -> None:
    registry = json.loads(path.read_text(encoding="utf-8"))
    if any(road["id"] == entry["id"] for road in registry["roads"]):
        raise RuntimeError(f"Road {entry['id']!r} is already present in {path}")
    registry["roads"].append(entry)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
        json.dump(registry, output, ensure_ascii=False, indent=2)
        output.write("\n")
        temporary = Path(output.name)
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("road_id", help="canonical id, for example tokyo-prefectural-318")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--wikipedia-api", default=WIKIPEDIA_API, help=argparse.SUPPRESS)
    parser.add_argument("--dry-run", action="store_true", help="print the entry without changing the registry")
    args = parser.parse_args()
    config, number = parse_road_id(args.road_id)
    title = wikipedia_search(f"{config['namePrefix']}{number}号", args.wikipedia_api)
    entry = build_entry(args.road_id, title)
    if not args.dry_run:
        write_registry(args.registry, entry)
    print(json.dumps(entry, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
