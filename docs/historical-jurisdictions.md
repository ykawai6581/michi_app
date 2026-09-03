# Historical jurisdictions

Historical jurisdictions are an optional Project map layer, independent from road identity and geometry. The first
provider is **Geoshape 歴史的行政区域データセットβ版**, and the first configured prefecture is Tokyo (`13`).
Geoshape is a preprocessing source only: the browser loads the committed manifest and one selected local GeoJSON
snapshot, never live Geoshape tiles.

## Add a snapshot

Download a historical snapshot from the [Geoshape vector data page](https://geoshape.ex.nii.ac.jp/city/vector/),
review its date and attributes, and supply the local GeoJSON explicitly:

```bash
python scripts/preprocess/preprocess-jurisdictions.py \
  --provider geoshape \
  --prefecture 13 \
  --snapshot-date YYYY-MM-DD \
  --input data/raw/geoshape/city/13/YYYY-MM-DD.geojson
```

The utility intentionally does not guess download URLs or scrape HTML. Raw inputs belong under the gitignored
`data/raw/` tree. Input must be a WGS84 GeoJSON FeatureCollection containing Polygon or MultiPolygon features.
Recognized source aliases include `name`/`city_name`, `parent_name`/`districtName`, `pref_name`, `code`, and
`resource_id`; normalized properties are `jurisdictionId`, `snapshotDate`, `prefectureName`,
`parentJurisdictionName`, `municipalityName`, `administrativeCode`, `sourceResourceId`, `sourceProvider`, and
`sourceDataset`.

Output is deterministic and unsimplified:

```text
public/data/jurisdictions/
├── manifest.json
└── geoshape/13/YYYY-MM-DD.geojson
```

The manifest is the only date/file registry used by the UI. Running the command for another actual date updates it;
there is no date interpolation. To add another prefecture later, add it to `data/sources/jurisdictions.json`, then
extend the initial Tokyo-only CLI guard and run the same process with that prefecture code.

The dataset is a beta historical reconstruction. Historical sources can disagree, administrative codes must not be
treated as globally stable historical identity, and these polygons should not be described as survey-grade truth.
