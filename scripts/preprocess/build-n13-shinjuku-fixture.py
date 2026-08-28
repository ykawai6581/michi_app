import json
from pathlib import Path
from numbers import Number

import ijson


INPUT_ROOT = Path("data/raw/n13")
OUTPUT = Path("data/fixtures/n13-shinjuku.geojson")

# [west, south, east, north]
CLIP_BBOX = [
    139.6000,
    35.6500,
    139.7800,
    35.7200,
]


def find_geojson(root: Path) -> Path:
    files = list(root.rglob("*.geojson"))

    if not files:
        raise RuntimeError(f"No .geojson files found under {root}")

    if len(files) > 1:
        print("Multiple GeoJSON files found:")
        for f in files:
            print("  ", f)
        print(f"Using: {files[0]}")

    return files[0]


def iter_coords(coords):
    """
    Recursively yield [lon, lat] coordinate pairs from a GeoJSON
    coordinate structure.

    ijson may parse decimal coordinates as Decimal rather than float,
    so use numbers.Number rather than only int/float.
    """
    if (
        isinstance(coords, (list, tuple))
        and len(coords) >= 2
        and isinstance(coords[0], Number)
        and isinstance(coords[1], Number)
    ):
        yield float(coords[0]), float(coords[1])
        return

    if isinstance(coords, (list, tuple)):
        for child in coords:
            yield from iter_coords(child)


def geometry_bbox(geometry):
    """
    Compute [xmin, ymin, xmax, ymax] for a GeoJSON geometry.
    """
    if not geometry:
        return None

    coords = geometry.get("coordinates")

    if coords is None:
        return None

    xmin = float("inf")
    ymin = float("inf")
    xmax = float("-inf")
    ymax = float("-inf")

    found = False

    for x, y in iter_coords(coords):
        found = True

        xmin = min(xmin, x)
        ymin = min(ymin, y)
        xmax = max(xmax, x)
        ymax = max(ymax, y)

    if not found:
        return None

    return [xmin, ymin, xmax, ymax]


def bboxes_intersect(a, b):
    """
    Return True if bbox a intersects bbox b.

    Bboxes are:
        [west, south, east, north]
    """
    return not (
        a[2] < b[0]
        or a[0] > b[2]
        or a[3] < b[1]
        or a[1] > b[3]
    )


source = find_geojson(INPUT_ROOT)

print("Reading source incrementally:")
print(f"  {source}")
print("")
print(f"Clip bbox: {CLIP_BBOX}")
print("")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

total = 0
selected = 0
no_geometry = 0
no_bbox = 0

with source.open("rb") as infile, OUTPUT.open(
    "w",
    encoding="utf-8",
) as outfile:

    # Write the start of the FeatureCollection manually so neither
    # the source nor output feature arrays need to be held in memory.
    metadata = {
        "type": "FeatureCollection",
        "metadata": {
            "source": (
                "MLIT National Land Numerical Information "
                "N13 Road Data 2024"
            ),
            "sourceDataset": "N13-2024",
            "purpose": "Shinjuku diagnostic fixture",
            "clipBbox": CLIP_BBOX,
            "note": (
                "Features whose bounding boxes intersect the diagnostic "
                "bounding box are retained. Geometry is not geometrically "
                "clipped in this first diagnostic."
            ),
        },
    }

    prefix = json.dumps(
        metadata,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    # Remove the final closing brace, append the features array ourselves.
    outfile.write(prefix[:-1])
    outfile.write(',"features":[')

    first_output_feature = True

    # ijson processes one feature at a time.
    for feature in ijson.items(
        infile,
        "features.item",
        use_float=True,
    ):
        total += 1

        geometry = feature.get("geometry")

        if geometry is None:
            no_geometry += 1
            continue

        feature_bbox = geometry_bbox(geometry)

        if feature_bbox is None:
            no_bbox += 1
            continue

        if not bboxes_intersect(feature_bbox, CLIP_BBOX):
            if total % 100000 == 0:
                print(
                    f"Processed {total:,} features "
                    f"— selected {selected:,}"
                )
            continue

        if not first_output_feature:
            outfile.write(",")

        json.dump(
            feature,
            outfile,
            ensure_ascii=False,
            separators=(",", ":"),
        )

        first_output_feature = False
        selected += 1

        if total % 100000 == 0:
            print(
                f"Processed {total:,} features "
                f"— selected {selected:,}"
            )

    outfile.write("]}")
    outfile.write("\n")


print("")
print("Finished.")
print(f"Input features:    {total:,}")
print(f"Selected features: {selected:,}")
print(f"No geometry:       {no_geometry:,}")
print(f"No usable bbox:    {no_bbox:,}")
print(f"Output:            {OUTPUT}")