# Canonical N13 road matching

Road identity and display geometry are deliberately separate:

* `data/roads/registry.json` owns canonical IDs, names, aliases, route numbers,
  jurisdiction, N13 classification, OSM identity, and matching parameters.
* OSM supplies a spatial reference for that configured identity.
* MLIT N13 supplies the preferred display geometry.
* Search loads only compact canonical road entities, never regional N13 data.

Build National Route 20 with:

```sh
python scripts/preprocess/match-road.py jp-national-20 --refresh-osm
```

The legacy command remains as a compatibility wrapper:

```sh
python scripts/preprocess/build-n13-koshu-fixture.py --refresh-osm
```

The generic matcher filters N13 by the registry entry, computes exact minimum
and regularly sampled median/p90 residuals, applies the configured diagnostic
selection limits, and retains each selected N13 carriageway in the output union.
It performs no COINS processing, geometry interpolation, or centerline synthesis.

It writes:

* `public/data/roads/jp-national-20.geojson`, a compact canonical search/display
  entity with configured/OSM identity and N13 geometry provenance;
* `public/data/roads/jp-national-20.report.json`, containing candidate and selected
  counts, residual statistics, OSM reference coverage, unresolved reference
  sections, N13 attribute distributions, and output byte size; and
* `public/search/roads.json`, the generated canonical-road search index.

Run `npm run dev`, search for `国道20号`, `国道20`, or `20号`, and select the
single canonical result to highlight the derived N13 geometry. `甲州街道` is not
an alias of this entity; its common/historical road entity remains separate.

Adding another road should normally require only a registry entry. National roads
use N13 class `1`; prefectural/metropolitan roads can use class `2`. Prefectural
IDs must include jurisdiction because route numbers can repeat across prefectures.
