from pathlib import Path

import geopandas as gpd


N13_INPUT = Path("data/fixtures/n13-shinjuku.geojson")
OSM_INPUT = Path("public/data/modern/shinjuku-osm.geojson")
OUTPUT = Path("data/fixtures/n13-koshu-kaido.geojson")

# How far from the known OSM alignment to search for N13 centerlines.
# 100 m is deliberately generous for this first comparison.
BUFFER_METERS = 100


print("Reading N13 Shinjuku fixture...")
n13 = gpd.read_file(N13_INPUT)

print("Reading existing OSM road data...")
osm = gpd.read_file(OSM_INPUT)

print("")
print(f"N13 features: {len(n13):,}")
print(f"OSM features: {len(osm):,}")


# ------------------------------------------------------------
# Keep only OSM road features relevant to 甲州街道 / Route 20.
# ------------------------------------------------------------

def contains_target(value):
    if value is None:
        return False

    text = str(value)

    return (
        "甲州街道" in text
        or "国道20号" in text
        or text == "20"
    )


road_mask = osm.geometry.geom_type.isin(
    ["LineString", "MultiLineString"]
)

target_mask = (
    osm["name"].apply(contains_target)
    if "name" in osm.columns
    else False
)

if "ref" in osm.columns:
    target_mask = target_mask | osm["ref"].apply(contains_target)

if "aliases" in osm.columns:
    target_mask = target_mask | osm["aliases"].apply(contains_target)


target = osm[road_mask & target_mask].copy()

if target.empty:
    raise RuntimeError(
        "Could not find any 甲州街道 / 国道20号 geometry "
        "in public/data/modern/shinjuku-osm.geojson"
    )


print(f"OSM target features: {len(target):,}")


# ------------------------------------------------------------
# Standardize CRS.
#
# Both source datasets should effectively be lon/lat, but force
# EPSG:4326 for spatial processing.
# ------------------------------------------------------------

if n13.crs is None:
    n13 = n13.set_crs("EPSG:6668")

if osm.crs is None:
    osm = osm.set_crs("EPSG:4326")

if target.crs is None:
    target = target.set_crs(osm.crs)


# ------------------------------------------------------------
# Project to a metric CRS.
#
# EPSG:6677 is JGD2011 / Japan Plane Rectangular CS IX,
# appropriate for the Tokyo region.
# ------------------------------------------------------------

metric_crs = "EPSG:6677"

n13_metric = n13.to_crs(metric_crs)
target_metric = target.to_crs(metric_crs)


# ------------------------------------------------------------
# Construct one corridor around all known OSM target segments.
# ------------------------------------------------------------

target_union = target_metric.geometry.union_all()

corridor = target_union.buffer(BUFFER_METERS)


# ------------------------------------------------------------
# Retain N13 lines intersecting that corridor.
# ------------------------------------------------------------

candidate_mask = n13_metric.geometry.intersects(corridor)

selected = n13_metric[candidate_mask].copy()

print(f"N13 corridor candidates: {len(selected):,}")


# ------------------------------------------------------------
# Add diagnostic provenance.
# ------------------------------------------------------------

selected["michi_match"] = "koshu_osm_corridor"
selected["michi_buffer_m"] = BUFFER_METERS


# Convert back to ordinary lon/lat GeoJSON.
selected = selected.to_crs("EPSG:4326")


OUTPUT.parent.mkdir(parents=True, exist_ok=True)

selected.to_file(
    OUTPUT,
    driver="GeoJSON",
)

print("")
print("Finished.")
print(f"Output features: {len(selected):,}")
print(f"Output: {OUTPUT}")