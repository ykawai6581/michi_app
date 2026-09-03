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
data/raw/geoshape/13/1931.l.topojson
data/raw/geoshape/13/1932.l.topojson
```

Process those two snapshots with:

```bash
python scripts/preprocess/preprocess-jurisdictions.py \
  --provider geoshape \
  --prefecture 13 \
  --snapshot-date 1931-12-31 \
  --input data/raw/geoshape/13/1931.l.topojson

python scripts/preprocess/preprocess-jurisdictions.py \
  --provider geoshape \
  --prefecture 13 \
  --snapshot-date 1932-12-31 \
  --input data/raw/geoshape/13/1932.l.topojson
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
`sourceDataset`.

Output is deterministic and unsimplified:

```text
public/data/jurisdictions/manifest.json
public/data/jurisdictions/geoshape/13/1931-12-31.geojson
public/data/jurisdictions/geoshape/13/1932-12-31.geojson
```

The manifest is the only date/file registry used by the UI. The browser has no Geoshape network dependency. Running
the command for another actual date updates the manifest; there is no date interpolation. Parent membership remains
source-derived from `parentJurisdictionName` rather than a hard-coded ward list. As a local source-data sanity check,
the inspected 1931 snapshot had 15 features with parent `東京市`, and the inspected 1932 snapshot had 33. Those counts
are observations, not validation rules or production logic. To add another prefecture later, add it to
`data/sources/jurisdictions.json`, then extend the initial Tokyo-only CLI guard and run the same process with that
prefecture code.

The source remains **Geoshape 歴史的行政区域データセットβ版**, a beta historical reconstruction. Historical sources
can disagree, administrative codes must not be treated as globally stable historical identity, and these polygons
should not be described as survey-grade truth.
