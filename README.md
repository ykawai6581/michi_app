# Michi Map — 道YouTube Historical Map App

YouTube で道・地名・都市の歴史を説明するための、**検索可能な歴史地図 + 地図シーンエディタ**です。一般的な地図閲覧サービスではなく、現代と過去の地物を重ね、対象を素早く検索・強調し、同じ画角を再現して動画素材にするワークフローを優先します。

## v0.1 でできること

- 東京・新宿を中心にした MapLibre GL JS のベクター地図をズーム／移動
- OpenFreeMap / OpenStreetMap の軽量な Presentation vector styleをdefault表示
- 国土地理院の標準地図タイルを、出典表示付きのオンライン現代ベースマップとして表示
- Presentation / Dark / 地理院地図 / 白背景 / 透明背景を即時切替
- 現代道路、歴史街道、宿場・地名、町丁目の小さなデモデータを個別に表示
- 名称・alias（全角／半角、空白、一丁目／1丁目を正規化）で検索し、線・点・面を適切に強調
- 強調色、線幅、透明度を即時調整
- road・polygonを左から徐々に描くhighlight animationと、ON/OFF可能なglow
- 面（最下層）→ road → location（最上層）の順で複数地物を同時選択し、checkboxで個別解除
- 選択したregion・road・locationの名称を、highlightと同色で地図上へ直接annotation
- default colorはroad RGB(239,98,98)、location RGB(100,194,242)、region RGB(50,100,170)で個別変更可能
- roadの端点はround、annotationは14px / 28pxを切替（default 28px）
- カメラ位置をブラウザの `localStorage` に保存し復元
- 現在の WebGL canvas を通常解像度 PNG としてダウンロード
- 静的ファイルだけで動作し、有料 API やバックエンドは不要

> **注意:** 同梱の形状は UI 動作確認のために手描きしたデモです。史実の判断・動画の根拠には使用しないでください。出典、確認日、confidence、注意書きを feature 単位で保持しています。

defaultのPresentation mapはOpenFreeMapのオンラインvector styleとOpenStreetMap由来データを利用します。詳細確認用の標準地図は国土地理院のオンラインtileです。どちらも初回表示にはインターネット接続が必要です。歴史街道、宿場、町丁目のoverlayは引き続き手描きsampleであり、実データと明確に区別しています。

## ローカルセットアップ

Node.js 20 以上（CI は Node.js 22）を使用します。

```bash
npm install
npm run dev
```

Vite が表示するローカル URL を開きます。品質チェックと production build は次のとおりです。

```bash
npm run lint
npm test
npm run build
```

### Road Builder (local developer tool only)

> **LOCAL DEVELOPMENT TOOL ONLY:** Road Builder is not deployed, is not a production backend, and does not alter
> the static GitHub Pages application. The normal `npm run build` continues to build only the existing Vite app.

Prepare the Python GIS dependencies used by the existing preprocessing scripts, then launch both the loopback-only
Python API and the separate Road Builder Vite application with:

```bash
npm run road-builder
```

Road Builder is the preferred local authoring interface for both canonical roads and reproducible map/video
projects. Use the **Roads / Projects** tabs without changing the existing road-matching workflow. The normal project
workflow is: **Projects → New project → choose modern roads → choose railways/stations → choose historical routes
and 宿場 → Save & Build → preview**. The project editor writes an atomic `projects/<id>/project.json`; ordinary Save
does not materialize output, while Save & Build calls the canonical `project_builder.materialize_project()` pipeline
and previews the browser-ready files from `public/projects/<id>/`.

Missing rail or CODH caches are reported in the catalog without preventing road editing. Run the preprocessing
command shown in the editor when those layers are needed. The production viewer accepts `?project=<id>` (and safely
defaults to `shinjuku`), so a built project can be opened at `http://localhost:5173/?project=my-project`.

Project configurations remain the reproducible source of truth and the CLI remains supported:

```bash
python scripts/build-project.py shinjuku
```

Open **http://127.0.0.1:5174**. The API listens only on `http://127.0.0.1:8765`; the development Vite server proxies
`/api` to it. The intended workflow is **New Road → Inspect OSM → Analyze N13 → Preview Match → Save & Build**.

- **Inspect OSM** resolves an unsaved draft through the canonical OSM source configuration and current N13 coverage.
  It displays the exact tag values found; selecting a discovered name explicitly adds it to the draft. It never
  fuzzy-matches or automatically declares variants equivalent.
- **Analyze N13** runs the current spatial/residual matcher stages and summarizes the selected draft classes
  independently. Suggested rows are visual hints only and never change the road's class checkboxes.
- Missing class partitions are read from the cache manifest. **Prepare class N** calls the existing N13 preprocessor
  for that one class and requires the manifest's raw source to still be present; no large preprocessing starts
  silently.
- **Preview Match** passes the in-memory draft to the existing matcher functions and returns reference, candidate,
  residual-pass, selected, and diagnostic GeoJSON without writing the registry.
- **Save Road** uses the same shared validation and atomic registry writer as `add-road.py`. Editing retains unknown
  fields because the UI round-trips the complete object. **Save & Build** saves first and invokes the existing
  `build-road.py` pipeline with a subprocess argument array.

For a local smoke test, keep `npm run road-builder` running, confirm the editor and map load at the URL above, choose
an existing road, and click **Inspect OSM**. A prepared N13 cache and its raw source are needed for analysis/preview.
Automated Road Builder checks can be run with:

```bash
python -m unittest discover -s scripts/road-ui -p 'test_*.py'
npm run road-builder:test
```

### Real modern overlay data

The Presentation basemap already uses real OpenStreetMap-derived vector tiles. To generate a small, reproducible Shinjuku-area overlay and search-index input for current Kōshū Kaidō roads and stations, run:

```bash
npm run data:osm:shinjuku
```

This writes the raw review network to `public/data/modern/shinjuku-osm.geojson` and non-road lookup entries to `public/search/modern-shinjuku.json`. To keep download and browser memory bounded, the Overpass query downloads every highway in a 300 m corridor around exact-name `甲州街道` and `新宿通り` seeds rather than a city-wide road extract. The complete corridor network—not a query-name-filtered subset—is passed to stroke generation. Every source feature retains its OSM URL, ID, retrieval date, highway class, ref, ODbL license, and the warning that modern geometry is not historical evidence.

Logical roads are generated once in the browser when the dataset loads, not on every search and not as a committed duplicate GeoJSON. `src/road-network/coins.ts` implements the COINS/every-best-fit baseline: source LineStrings are segmentized; endpoints use actual topology with a 0.75 m floating-point snap tolerance; straight continuation has angle 180°; every segment chooses the maximum-angle neighbor independently at each endpoint; and links are accepted only when both segments choose each other and their continuation angle is at least 120°. Exact geometric ties within 0.1° use highway class, then ref, then name solely as tie-breakers. If thematic evidence is still tied, the junction remains ambiguous and broken. No nearest-endpoint connector, spline, Dijkstra completion, or invented geometry is used.

Search labels are attached after all corridor strokes have been generated. Thus an unnamed or differently tagged segment belongs to a `甲州街道` or `新宿通り` result only when it is part of the same mutual-best geometric stroke. Search names have no aliases: `20`, `430`, `麹町大通り`, and other names do not match `甲州街道`. Each logical entity contains elementary-segment provenance and COINS debug records with endpoint candidates, continuation angles, best candidates, mutual links, rejection reasons, and stroke IDs. Use the `論理道路` / `元セグメント` toggle to compare the complete stroke with only the directly named source ways. Run `npm run dev` or `npm run build && npm run preview` to review locally.

The implementation follows the good-continuation stroke concept of Thomson & Richardson (1999), the geometric every-best-fit strategy evaluated by Zhou & Li (2012), and the segmentization, endpoint best-link, mutual cross-check, and recursive stroke grouping described by Tripathy et al. (2021) and COINS. Ordinary COINS output is kept as the baseline; dual-carriageway pattern post-processing and residual Type-B gap completion are intentionally deferred until debug output demonstrates a specific need.

A logical-road result reports its stroke count, topology-break count, and whether the loaded file contains the surrounding corridor or only named seeds. In the older bundled extract, `新宿通り` has 10 topology breaks, 5 non-mutual-best ends, and 1 below-threshold end. The dominant visible gaps are therefore absent topology, not confusion between parallel carriageways. The rebuild workflow rejects seed-only extracts so the next data refresh must contain graph-connected surrounding ways. Parallel carriageways remain separate COINS strokes unless OSM topology connects them; merging them geometrically would invent a centerline and would not repair a missing source section.

To build the files without a local GIS environment, open **Actions → Rebuild Shinjuku OSM data → Run workflow**. The manual workflow validates the result, uploads a 14-day review artifact, and commits changed generated files to the repository's default branch. That commit triggers the normal Pages deployment. The data workflow only needs to be rerun when refreshing or changing source data—not for CSS, layout, colors, or other cosmetic application changes. The repository must allow GitHub Actions **Read and write permissions** under **Settings → Actions → General → Workflow permissions**.

The downloader uses an identified HTTP GET request and tries three public Overpass instances sequentially. Transient 5xx/rate-limit failures are retried for up to three rounds with increasing delays. To force one instance, set `OVERPASS_URL`; to supply an ordered comma-separated list, set `OVERPASS_URLS`. For example: `OVERPASS_URL=https://overpass.kumi.systems/api/interpreter npm run data:osm:shinjuku`. Failed responses include the attempt number and a short response excerpt in the Actions log.

`dist/` は相対パスで生成されるため、GitHub Pages の repository site に配置できます。

## Reusable rail and historical source caches

## Project materialization

Reusable caches are large, build-time inputs and never browser assets. A project config selects a small subset and
`build-project.py` writes the complete static bundle consumed by React/MapLibre. Bounds can be an explicit WGS84
`[minLon, minLat, maxLon, maxLat]` bbox, or can be derived from the full built N13 geometry of the project's selected
canonical modern roads:

```json
"bounds": {
  "mode": "auto",
  "from": "modernRoads",
  "paddingKm": 3
}
```

When `bounds` is omitted, the same `modernRoads` auto mode and 3 km padding are the default. Auto mode unions every
selected road's canonical `public/data/roads/<road-id>-n13.geojson` geometry, estimates a suitable local UTM CRS, and
expands that combined extent by the configured real-world distance. It never uses the full N13 source extent or the
OSM reference geometry. This produces the intended pipeline: project road geometry → nearby spatial context → bbox
rail/station extraction → small browser bundle. OSM `railway=*` ways remain the physical track context, while OSM
`type=route` + `route=railway` relations are the canonical logical lines used by search and highlighting. Passenger
`route=train` services are intentionally not logical railway identities. The derived bbox does not clip canonical roads, CODH road routes, or
CODH post selections; it only controls bbox-mode supporting layers such as physical tracks and stations. The resolved WGS84
bbox and its derivation metadata are recorded in `manifest.json`, while output `project.json` preserves the configured
auto specification.

Prepare sources, materialize the project, and start Vite:

```bash
python scripts/preprocess/preprocess-n13.py data/raw/n13/N13.geojson --output data/cache/n13/roads
python scripts/preprocess/preprocess-rail.py
python scripts/preprocess/preprocess-codh.py
python scripts/build-project.py shinjuku
npm run dev
```

`projects/<id>/project.json` contains an ID, display name, optional explicit/auto bounds, canonical modern-road IDs,
bbox-mode station selectors, railway selection settings, and exact CODH route IDs. The preferred railway setting is
`{"mode":"near-modern-roads","distanceKm":3}`: if any portion of a cached logical route intersects the metric road
corridor, the complete relation geometry is selected without clipping to either the corridor or project bbox. A missing cache or canonical build fails with the preprocessing command
needed to create it. Rail bbox reads use GeoParquet filtering and preserve every parallel source track; stations are
selected spatially without further deduplication. CODH roads and posts are selected by exact `routeId` without
matching, snapping, simplification, or name-based post deduplication.

Generated, deployable files are tracked under:

```text
public/projects/<id>/
├── project.json
├── manifest.json
├── data/
│   ├── modern-roads.geojson
│   ├── railways.geojson
│   ├── railway-routes.geojson
│   ├── stations.geojson
│   ├── historical-roads.geojson
│   └── historical-posts.geojson
└── search/entities.json
```

The manifest records timestamp, bounds, railway selection, inputs, outputs, layer families, and separate physical-track
and logical-route counts. `railways.geojson` is the local physical base layer; `railway-routes.geojson` contains full
relation `MultiLineString` features. Search emits one entity per selected relation. Tracks without a usable relation
retain only conservative exact-tag fallback grouping; names are never fuzzily normalized.

These build-time sources do **not** create project bundles or change the production application:

| Entity | Source → normalized cache |
| --- | --- |
| Modern railway tracks | OpenStreetMap → `data/cache/osm/rail/tracks.parquet` |
| Modern passenger stations | OpenStreetMap → `data/cache/osm/rail/stations.parquet` |
| Historical major roads | CODH Kaido data → `data/cache/codh/edo-roads/roads.parquet` |
| Historical post stations (宿場) | CODH Kaido data → `data/cache/codh/edo-posts/posts.parquet` |

Install `requirements-preprocess.txt`. Rail first inspects the regional PBF configured in `data/roads/sources.json`.
The OSM GDAL driver layers `points`, `lines`, `multilinestrings`, `multipolygons`, and `other_relations` are read when
present so both infrastructure and the different station representations are available. It falls back to the configured
Overpass endpoint for the explicit Tokyo working extent only when the PBF is absent; `--refresh-osm` forces Overpass:

```bash
python scripts/preprocess/preprocess-rail.py
python scripts/preprocess/preprocess-rail.py --refresh-osm
python scripts/preprocess/preprocess-rail.py --input data/raw/osm/tokyo-rail.geojson
```

Tracks retain distinct, unsimplified OSM ways. `includedRailwayValues` and `stationRailwayValues` in
`data/roads/sources.json` are the authoritative runtime policy. By default `rail`, `subway`, `light_rail`, and `tram`
are included; unconfigured `railway` values such as proposed, construction, disused, and abandoned are excluded.
Infrastructure tagged `service=yard`, `service=siding`, or `service=spur` remains included when its `railway` value is
included, and both `service` and `usage` are preserved for later presentation filtering.
Stations and halts form a separate point layer. Points remain unchanged; polygons use an area centroid and record the
source geometry type. Only repeated copies of the same OSM element ID are removed—similar names and broad authority
identifiers never cause a merge.

CODH metadata, official download URLs, formats, and raw paths are in `data/sources/codh.json`. The normal command
downloads the current official **江戸主要街道 version 4** ZIP and **江戸宿場 version 1** GeoJSON when absent,
validates each response before atomically publishing it under the gitignored `data/raw/codh/` tree, and then normalizes
the source. The road ZIP member `geopackage/edo-road-v4.gpkg` is extracted under `data/raw/codh/extracted/edo-road/`,
validated as a GeoPackage, and the configured `road_codh_260731` layer is verified against the inspected layers. Roads
map `numbering`, `name`, `alt_name`, `start`, and `end` into normalized source records while retaining every geometry,
including multiple features with the same route ID. The post source is direct
GeoJSON and has no archive or GeoPackage step; `id`, `road_id`, `name`, `jk`, and `jk_id` map to distinct post records,
and neither shared names nor shared historical-place IDs cause deduplication:

```bash
python scripts/preprocess/preprocess-codh.py
python scripts/preprocess/preprocess-codh.py --refresh
python scripts/preprocess/preprocess-codh.py --roads /path/to/roads.geojson --posts /path/to/posts.geojson
```

The source configuration records CODH/ROIS-DS attribution and the published Creative Commons Attribution 4.0
International (CC BY 4.0) license separately for both datasets. Both workflows write WGS84 GeoParquet, manifests, and
small discovery indexes. Roads and posts retain exact CODH route IDs, including branch IDs such as `R400-1`,
so road `R003` links to `R003` 宿場 without name matching, and original properties remain available as JSON. Task C will
later select small video-specific subsets; it is not implemented here. These reusable caches stay outside browser assets, and neither OSM rail nor
CODH geometry passes through the OSM↔N13 canonical-road matcher.

## 画面構成

左側の広い地図を動画素材のキャンバス、右側を制作パネルとして設計しています。検索、レイヤー、強調スタイル、保存画角の順に、制作時の操作手順が上から下へ流れます。モバイルでは「編集パネル」ボタンからサイドバーを開けます。

## データディレクトリ設計

| 場所 | 役割 |
| --- | --- |
| `src/data/sample.ts` | v0.1 の小さな表示用 GeoJSON FeatureCollection |
| `data/source/` | 将来の再取得可能な raw 公開データ（巨大ファイルは commit しない） |
| `data/processed/` | 加工済み成果物。大容量時は PMTiles／外部配布を検討 |
| `data/custom/` | 独自調査・補正データ。出典と不確実性を必須にする |
| `data/metadata/` | dataset 単位の出典・ライセンス・派生ファイル |
| `projects/` | 地理データとは独立した動画 project／scene |

空のデータ用ディレクトリは必要になった時点で作成します。全国 PMTiles、DEM、大型 raster、全国 OSM extract は無計画に Git に追加せず、再現可能な download/process script、GitHub Releases、または適切な静的 hosting を利用します。

### GeoJSON レイヤーを追加する

1. WGS84 (`EPSG:4326`) の GeoJSON を準備し、各 feature に一意の `id`、`name`、`type` を付けます。
2. `source`, `source_url`, `license`, `checked`, `confidence`, `note` を可能な限り feature に保持します。不明な経路を推測で接続してはいけません。
3. 小さなデータは `src/data/`、配布用データは `public/data/{historical,modern,terrain,custom}/` に置きます。
4. source ID と layer ID は `src/map/config.ts`、描画規則は `src/map/layers.ts` に集約します。
5. dataset 情報を `data/metadata/sources.yml` と `licenses.yml` に追記します。

### 道路 registry に路線を追加する

#### Canonical-road build sources

Canonical roads use build-time data that is deliberately separate from browser assets. Put a full/natural-extent
N13 GeoJSON under `data/raw/n13/`, then create the default major-road cache (class 1 national and class 2
prefectural) with:

```bash
python scripts/preprocess/preprocess-n13.py data/raw/n13/N13.geojson --output data/cache/n13/roads
```

For compatibility with the earlier command, `--output data/cache/n13/roads.parquet` is also accepted and is
normalized to the partition root `data/cache/n13/roads`. An existing old `roads.parquet` file is left untouched.

The cache is partitioned as `class=1/roads.parquet` and `class=2/roads.parquet`, so matching reads only the required
class. The preprocessor supports the complete N13 source vocabulary (classes 1 through 6), but unusual classes are
intentionally opt-in for named-road work and can be added without rebuilding or combining the major-road partitions:

```bash
python scripts/preprocess/preprocess-n13.py data/raw/n13/N13.geojson --output data/cache/n13/roads --classes 3
```

Preprocessing also writes `data/cache/n13/roads/manifest.json` with the raw source path, feature count, CRS,
natural WGS84 bounds, available classes, and partition counts. Each partition includes per-feature WGS84 bbox
columns so the matcher can use Parquet predicate pushdown before exact corridor and residual tests. A later
`--classes 3` run merges its partition metadata without forgetting existing class 1/2 partitions.

The preprocessor reads the source in chunks, and `match-road.py` reads GeoParquet without a Shinjuku spatial
filter. Both `data/raw/` and `data/cache/` are gitignored; only small canonical outputs in `public/data/roads/`
are web assets.

OSM reference acquisition is configured in `data/roads/sources.json`. In `auto` mode it reuses a cached reference,
then tries the configured regional source (`data/raw/osm/kanto-latest.osm.pbf`), and finally uses Overpass. Local
PBF reading is optional and depends on the installed GDAL OSM driver. Overpass bounds are source configuration
only as a legacy fallback: normal matching reads the N13 manifest bounds, uses those bounds for Overpass, and clips
cache/local/Overpass results to the same working extent. OSM cache sidecars record their coverage; a cache covering
a larger extent is clipped safely, while one from a smaller extent is rebuilt automatically. Build one road with:

Statutory references with an OSM `network` use only member ways of the exact `type=route`, `route=road`, `ref`, and
`network` relation. If that relation is absent, the Overpass fallback accepts only highway ways directly tagged with
both the exact `ref` and `network`; it never broadens to same-number ways. The local GIS `lines` layer is used for a
networked reference only when it exposes an exact `network` field; otherwise `auto` mode falls through to Overpass
(`local` mode reports the limitation). Networkless legacy references retain ref-only behavior with an explicit warning.

Road-specific alignment filtering happens only after that canonical acquisition. A statutory reference may set
`reference.excludeNames` to exact OSM segment names (for example `["八王子南バイパス"]`). The matcher compares exact,
trimmed semicolon-separated tokens across `name`, `name:ja`, `name:en`, and `alt_name` by default; unnamed members and
nonmatching names remain included. `reference.excludeNameTags` can override those fields. Exclusions do not participate
in the raw OSM cache identity, so editing them reuses the complete `ref + network` acquisition while Inspect/Preview
show excluded ways separately and all N13 analysis uses only the retained geometry.

```bash
python scripts/preprocess/match-road.py jp-national-20
```

Matching is deliberately two-stage. The existing median/p90 residual limits produce a generous spatial shortlist.
For each disconnected OSM reference part, Stage 2 samples ordered OSM chainage and uses Viterbi-style inference to
choose the N13 edge sequence with the best distance/orientation emissions and graph-continuity transitions. Progress,
monotonicity, and orientation are soft costs rather than hard per-feature eligibility gates, so a locally awkward
edge remains available when it is needed between strong road sections. The reasoning graph detects both endpoint
connections and endpoints meeting another edge's interior without changing source coordinates.

An alternate N13 chain is accepted as a parallel carriageway only when a distinct OSM reference part selects it.
Same-class selections on sustained parallel reference parts remain independent carriageways. Sustained selections
of different classes on nearby parallel parts instead compete for the same route interval: configured class priority
wins before source continuity and residual evidence are considered. The run-length guard permits a short overlap at
a genuine longitudinal class handoff, and a lower-priority class can still continue beyond the end of the preferred
class. A neighboring frontage road following the same single OSM centerline is not promoted merely because it is long
and parallel. Internal unmatched sample runs are repaired through the complete Stage-1 graph when a bounded connector
exists, while unmatched leading/trailing samples are treated as source-coverage termination. Original N13 vertices
remain the public geometry; only the existing display endpoint snap is applied afterward.

Every build writes all residual-shortlisted candidates and their selection reasons to the gitignored diagnostic
GeoJSON. To validate the two current named roads with a local cache (including N13 class 3), run:

```bash
python scripts/preprocess/match-road.py tokyo-named-inokashira-dori \
  --n13 data/cache/n13/roads \
  --diagnostics data/diagnostics/tokyo-named-inokashira-dori-selection.geojson
python scripts/preprocess/match-road.py tokyo-named-koshu-kaido \
  --n13 data/cache/n13/roads \
  --diagnostics data/diagnostics/tokyo-named-koshu-kaido-selection.geojson
```

Per-road `networkSelection` registry values can override `progressSampleMeters`, `maximumSampleDistanceMeters`,
`unmatchedSampleCost`, `edgeSwitchCost`, `disconnectedTransitionCost`, `maximumTransitionPathMeters`,
`maximumGapConnectorMeters`, `maximumGapDetourRatio`, `orientationCostWeight`, `progressCostWeight`,
`monotonicityCostWeight`, `minimumProgressRatio`, `minimumChainageMonotonicity`, and
`maximumOrientationMismatchDegrees`. The latter three values define where soft costs begin; they do not exclude an
edge. These are generic matcher controls, not road-name exceptions.

The old `public/data/modern/shinjuku-osm.geojson` and `scripts/download/download-shinjuku-osm.mjs` remain only for
the separate current-road/station UI prototype described above; canonical matching does not read them. The old
`data/fixtures/n13-shinjuku.geojson` input is no longer created or referenced by the canonical pipeline.

Registry entries distinguish `statutory-road` identities from `named-road` identities. Statutory roads configure
an `osm-ref` reference (route relation/ref and optional network), while named roads configure an `osm-name`
reference with explicit accepted values and tag fields. Both use `n13.classifications`, which may contain multiple
classes. Adding 青梅街道 or 明治通り therefore requires only another `named-road` registry entry with its exact OSM
names, N13 classes, jurisdiction, aliases, and matching thresholds, followed by `match-road.py ROAD_ID`; no React
change is required. The matcher reports disconnected same-name OSM components rather than bridging gaps, retains
parallel carriageways, and records selected N13 classes and statutory-ref provenance. Historical alignments are
intentionally outside this current-road registry domain.

路線 ID から日本語版 Wikipedia を検索し、正式名、基本 alias、N13 区分、OSM ref、既定の matching 設定を `data/roads/registry.json` に追加できます。

```bash
python scripts/preprocess/add-road.py tokyo-prefectural-319
```

法定道路では `tokyo-prefectural-NUMBER` と `jp-national-NUMBER` をサポートします。都県境をまたぐ路線の Wikipedia 記事名（例: `東京都道・埼玉県道25号…`）も検索します。`tokyo-named-*` の通称道路は、構成する法定路線を推測せず、表示名、OSM 名、N13 区分を明示して登録します。OSM 名と alias はオプションを繰り返して複数指定できます。

```bash
python scripts/preprocess/add-road.py tokyo-named-shinjuku-dori \
  --display-name "新宿通り" --osm-name "新宿通り" --n13-classes 1 2 3
```

OSM で法定上の路線 identity が分かっていても、通称道路に対応する N13 feature が同じ区分とは限りません。
たとえば羽田周辺の環八通りは N13_003 の区分 5 を含むため、必要な partition だけを追加し、この道路が
実際に選択する区分を明示します。

```bash
python scripts/preprocess/preprocess-n13.py data/raw/n13/N13.geojson \
  --output data/cache/n13/roads --classes 5
python scripts/preprocess/add-road.py tokyo-named-kanpachi-dori \
  --display-name "環八通り" --osm-name "環八通り" --n13-classes 2 3 5
```

利用可能な N13 区分と各 canonical road が選択する区分は別です。通称道路を全区分検索にはせず、検証した
`--n13-classes` だけを登録してください。引数を省略した通常の preprocessing は引き続き区分 1 と 2 のみです。

書き込み前に候補を確認する場合は `--dry-run` を付けてください。既存 ID、対応外の ID、または正式名として確認できない検索結果は registry を変更せず、修正方法を含む短いエラーを表示します。追加後の形状生成は別工程なので、N13 road cache を用意して `scripts/preprocess/match-road.py` を実行してください。

登録と形状生成を同じ ID で続けて実行する場合は、まとめたコマンドを使用できます。

```bash
python scripts/preprocess/build-road.py tokyo-prefectural-319
```

未登録の法定道路なら `add-road.py` を実行した後に `match-road.py` を実行します。未登録の通称道路は必要なメタデータを示す登録コマンドとともに明確なエラーになります。すでに登録済みなら追加処理を省略して matching だけを再実行します。`--n13 PATH`、`--registry PATH`、`--refresh-osm`、`--overpass-url URL` も指定でき、matching 処理へ引き継がれます。いずれかの処理が失敗した場合、後続処理は実行されません。

### 検索 index

描画データを直接全文検索する将来設計にはしません。v0.1 はデータが小さいため `src/data/sample.ts` から軽量な entity 配列を構築していますが、検索処理自体は `src/search/` に分離済みです。実データでは軽量 JSON index（entity ID、name、aliases、bbox/center）から ID を解決し、PMTiles／GeoJSON の feature を選択する構成へ移行します。歴史道路と現代道路は alias が同じでも別 entity のまま候補に表示します。

## GitHub Pages deploy

Repository の **Settings → Pages → Source** を **GitHub Actions** に設定します。`main` への push または手動実行で `.github/workflows/deploy.yml` が lint、unit test、build を行い、`dist/` を Pages に deploy します。

## ライセンスと attribution

データを追加する前に、dataset 名、提供者、version、取得日、配布ページ、license、必要な表記、派生ファイルを `data/metadata/sources.yml` に記録してください。アプリコードとデモ形状の扱いは repository の license に従います。将来の CODH、GSI、e-Stat、OSM データは取得時点の公式配布条件を再確認し、表示・動画で必要な attribution を省略しません。

## 現在の制約と次の段階

- 地図形状は少数の手描き sample で、CODH／OSM／e-Stat の実データではありません。
- 現代vector basemapはOpenFreeMap、詳細referenceは国土地理院のonline serviceです。offline時は白背景・透明背景と同梱sampleだけが利用できます。
- PNG は現在の画面サイズ／device pixel ratio です。1920×1080、4K、透明背景の固定 preset は未実装です。
- 保存画角は端末内だけに保存され、project JSON の UI import/export は未実装です。
- 地物編集、terrain、江戸水域、PMTiles protocol、scene animation は v0.2 以降です。

次は公式データの最新仕様とライセンスを確認した上で、CODH 街道・宿場の再現可能な ingestion、search index 生成、PMTiles 化を追加します。

Road Builder can also reset an existing canonical road with **Delete Road…**. The confirmation lists projects that
still reference the road; those reproducible project configs are never changed automatically. Deletion atomically
removes the registry entry and only exact road-specific generated/reference artifacts, never shared source caches.

The Projects tab exposes **Delete Project…** after an existing project is loaded. After confirmation it removes that
project's configuration and materialized preview directory, while leaving canonical roads and all shared source data
untouched.
