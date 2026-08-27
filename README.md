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

### Real modern overlay data

The Presentation basemap already uses real OpenStreetMap-derived vector tiles. To generate a small, reproducible Shinjuku-area overlay and search-index input for current Kōshū Kaidō roads and stations, run:

```bash
npm run data:osm:shinjuku
```

This writes `public/data/modern/shinjuku-osm.geojson` and `public/search/modern-shinjuku.json`. Every generated feature retains its OSM object URL, retrieval date, ODbL license, and an explicit warning that current OSM geometry is not evidence for a historical alignment. The official CODH road/post-town files must be verified and ingested separately rather than inferred from these modern roads.

To build the files without a local GIS environment, open **Actions → Rebuild Shinjuku OSM data → Run workflow**. The manual workflow validates the result, uploads a 14-day review artifact, and commits changed generated files to the repository's default branch. That commit triggers the normal Pages deployment. The data workflow only needs to be rerun when refreshing or changing source data—not for CSS, layout, colors, or other cosmetic application changes. The repository must allow GitHub Actions **Read and write permissions** under **Settings → Actions → General → Workflow permissions**.

The downloader uses an identified HTTP GET request and tries the primary Overpass instance followed by a secondary instance, sequentially, when no endpoint is specified. To force one instance for debugging, set `OVERPASS_URL`, for example `OVERPASS_URL=https://overpass.kumi.systems/api/interpreter npm run data:osm:shinjuku`. Failed responses include a short response excerpt in the Actions log so HTTP policy and query errors can be diagnosed.

`dist/` は相対パスで生成されるため、GitHub Pages の repository site に配置できます。

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
