# Historical jurisdictions

Historical jurisdictions are an optional Project map layer, independent from road identity and geometry. The first
provider is **Geoshape 歴史的行政区域データセットβ版**, and the first configured prefecture is Tokyo (`13`).
Geoshape is a preprocessing source only: the browser loads the committed manifest and one selected local GeoJSON
snapshot, never live Geoshape tiles.

## Add a snapshot

Download and review a historical snapshot separately, then supply the local file explicitly. The preprocessor accepts
both the existing GeoJSON FeatureCollection input and the actual Geoshape TopoJSON format. Geoshape's inspected Tokyo
files are Topologies whose `objects.city` value is a GeometryCollection, so the `city` object is selected automatically.
For another unambiguous object, pass `--topology-object NAME`.

For example, locally downloaded source files may be stored at:

```text
data/raw/geoshape/13/low/1931.l.topojson
data/raw/geoshape/13/low/1932.l.topojson
data/raw/geoshape/13/high/1931.h.topojson
data/raw/geoshape/13/high/1932.h.topojson
```

Process those two snapshots with:

```bash
python scripts/preprocess/preprocess-jurisdictions.py \
  --provider geoshape \
  --prefecture 13 \
  --resolution low \
  --snapshot-date 1931-12-31 \
  --input data/raw/geoshape/13/low/1931.l.topojson

python scripts/preprocess/preprocess-jurisdictions.py \
  --provider geoshape \
  --prefecture 13 \
  --resolution high \
  --snapshot-date 1932-12-31 \
  --input data/raw/geoshape/13/high/1932.h.topojson
```

The utility intentionally does not guess download URLs or scrape HTML. Raw inputs belong under the gitignored
`data/raw/` tree. TopoJSON transform and delta-encoded arcs are decoded without simplification into the same
Polygon/MultiPolygon normalization path used for WGS84 GeoJSON. The verified Geoshape properties map as follows:

| Geoshape property | Runtime property |
| --- | --- |
| `N03_001` | `prefectureName` |
| `N03_003` | `parentJurisdictionName` |
| `N03_004` | `municipalityName` |
| `N03_007` | `administrativeCode` |
| `properties.id` | `sourceResourceId` |

`STARTYEAR` and `ENDYEAR` are retained as `sourceStartYear` and `sourceEndYear`; they do not replace the selected
`snapshotDate`. Empty or null `N03_003` values are omitted rather than exposed as parent names. Existing source aliases
remain supported. Normalized properties include `jurisdictionId`, `snapshotDate`, `prefectureName`,
`parentJurisdictionName`, `municipalityName`, `administrativeCode`, `sourceResourceId`, `sourceProvider`, and
`sourceDataset`, and the explicit `sourceResolution` (`low` or `high`).

Each command writes two deterministic, unsimplified display assets:

```text
public/data/jurisdictions/manifest.json
public/data/jurisdictions/geoshape/13/low/1931-12-31.geojson
public/data/jurisdictions/geoshape/13/low/1931-12-31.parents.geojson
public/data/jurisdictions/geoshape/13/high/1932-12-31.geojson
public/data/jurisdictions/geoshape/13/high/1932-12-31.parents.geojson
```

`low` is the CLI and project-config default. `high` is optional and provides finer boundary detail only when a
separately supplied `.h.topojson` source has been processed. Each resolution is normalized independently; high
geometry is never derived from low geometry. Its parent-city asset is likewise dissolved from the selected
resolution's own ward polygons.

The ordinary `.geojson` snapshot remains the canonical, unchanged municipality/ward representation. The derived
`.parents.geojson` display remains geographically complete, but replaces each eligible ward group with a real Shapely
polygon union. This is analogous in spirit to visually integrating ward polygons into their parent municipality; it
does not claim exact implementation equivalence with Geoshape's website. Eligibility requires a non-empty
`parentJurisdictionName` and a group composed entirely of `区` children. Consequently, city wards such as those of
`東京市` are dissolved, while administrative `郡` containing towns or villages are retained as their original
municipality features.

A derived parent polygon is not presented as an original polygon supplied by Geoshape. It is marked `derived`, records
its dissolve derivation, and retains `memberCount`, sorted `memberJurisdictionIds`, and sorted `sourceResourceIds`.
The manifest snapshot entry supplies both `path` and `parentDisplayPath` (plus their feature counts); the frontend does
not guess filenames. The compact **表示単位** control switches between canonical `市区町村` and `親自治体で統合（区のみ）`,
and old project configurations default to the canonical municipality display.

Manifest schema version 2 nests `availableDates` and `snapshots` below `resolutions.low` and `resolutions.high`, so
each resolution can have a different date set. Schema version 1 prefecture entries remain readable as low resolution,
and the preprocessor migrates that metadata without changing legacy paths until each low asset is regenerated.
The manifest is the only date/file registry used by the UI. The browser has no Geoshape network dependency. Running
the command for another actual date updates both asset entries; there is no date interpolation. Parent membership
remains source-derived from `parentJurisdictionName` rather than a hard-coded ward list. As a local source-data sanity
check, the inspected 1931 snapshot had 15 features with parent `東京市`, and the inspected 1932 snapshot had 33. After
regeneration, those inputs should yield one derived `東京市` feature with `memberCount` 15 and 33 respectively. Those
counts are observations, not validation rules or production logic. To add another prefecture later, add it to
`data/sources/jurisdictions.json`, then extend the initial Tokyo-only CLI guard and run the same process with that
prefecture code.

The source remains **Geoshape 歴史的行政区域データセットβ版**, a beta historical reconstruction. Historical sources
can disagree, administrative codes must not be treated as globally stable historical identity, and these polygons
should not be described as survey-grade truth.
