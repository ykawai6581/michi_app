# Canonical N13 road matching

Road identity and source geometry are separate. `data/roads/registry.json` owns
canonical IDs, names, aliases, route numbers, jurisdiction, N13 classification,
OSM identity, and matching parameters. OSM supplies the identity reference and
MLIT N13 supplies the preferred display geometry.

Build a registered road with:

```sh
python scripts/preprocess/match-road.py jp-national-20 --refresh-osm
```

For each successful registry entry, the generic matcher writes:

* `public/data/roads/<id>-n13.geojson` — compact matched N13 geometry;
* `public/data/roads/<id>-osm.geojson` — compact public OSM reference geometry;
* `public/data/roads/<id>.report.json` — candidate/selected counts, matching
  thresholds, residual statistics, OSM coverage, unresolved sections, N13
  attribute distributions, and output sizes; and
* `public/search/roads.json` — canonical identities and paths to both geometries.

The application loads both files generically from the search index. A search
result is one canonical entity with `roadSourceGeometries.n13` and
`roadSourceGeometries.osm`; the permanent layer controls independently show N13
(on by default) and OSM (off by default). Regional N13, preprocessing caches, and
residual diagnostics are never loaded by the browser.

## Add a second road

1. Add its identity and matching configuration to `data/roads/registry.json`.
2. For a prefectural road, include the jurisdiction in its canonical ID because
   route numbers repeat between prefectures, and configure N13 classification `2`.
3. Run `python scripts/preprocess/match-road.py <new-id> --refresh-osm`.
4. Commit the two compact GeoJSON files, report, and regenerated search index.

No React or TypeScript change is required. `甲州街道` is intentionally not an
alias of `jp-national-20`; common and historical routes remain separate entities.
