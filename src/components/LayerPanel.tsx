import type { BasemapMode, LayerVisibility, RoadSourceVisibility } from '../types/geo'

const basemaps: { id: BasemapMode; name: string; hint: string }[] = [
  { id: 'presentation', name: 'Presentation', hint: 'ベクター' },
  { id: 'dark', name: 'Dark', hint: '夜間・高contrast' },
  { id: 'gsi', name: '地理院地図', hint: '詳細' },
  { id: 'white', name: '白背景', hint: '素材用' },
  { id: 'transparent', name: '透明', hint: '合成用' },
]

const overlays: { id: Exclude<keyof LayerVisibility, 'basemap'>; name: string; hint: string }[] = [
  { id: 'modernRoads', name: '現代道路', hint: 'canonical' },
  { id: 'railways', name: '鉄道', hint: 'OSM' },
  { id: 'stations', name: '駅', hint: 'OSM' },
  { id: 'historicalRoads', name: '江戸街道', hint: 'CODH' },
  { id: 'historicalPosts', name: '宿場', hint: 'CODH' },
]

export function LayerPanel({ value, onChange, roadSources, onRoadSourcesChange }: { value: LayerVisibility; onChange: (value: LayerVisibility) => void; roadSources: RoadSourceVisibility; onRoadSourcesChange: (value: RoadSourceVisibility) => void }) {
  return <section className="panel-section"><div className="section-heading"><span className="eyebrow">BASEMAP</span><h2>背景地図</h2></div><div className="basemap-grid">{basemaps.map((basemap) => <label className="basemap-option" key={basemap.id}><input type="radio" name="basemap" checked={value.basemap === basemap.id} onChange={() => onChange({ ...value, basemap: basemap.id })}/><span><strong>{basemap.name}</strong><small>{basemap.hint}</small></span></label>)}</div><div className="section-heading overlay-heading"><span className="eyebrow">ROAD GEOMETRY</span><h2>道路形状</h2></div><div className="layer-list"><label className="layer-row"><span className="layer-swatch roads"/><span><strong>N13 道路</strong><small>優先表示形状</small></span><input type="checkbox" checked={roadSources.n13} onChange={() => onRoadSourcesChange({ ...roadSources, n13: !roadSources.n13 })}/><i aria-hidden="true"/></label><label className="layer-row"><span className="layer-swatch historicalRoads"/><span><strong>OSM 道路</strong><small>参照形状・青破線</small></span><input type="checkbox" checked={roadSources.osm} onChange={() => onRoadSourcesChange({ ...roadSources, osm: !roadSources.osm })}/><i aria-hidden="true"/></label></div><div className="section-heading overlay-heading"><span className="eyebrow">OVERLAYS</span><h2>重ねる情報</h2></div><div className="layer-list">{overlays.map((overlay) => <label className="layer-row" key={overlay.id}><span className={`layer-swatch ${overlay.id}`} /><span><strong>{overlay.name}</strong><small>{overlay.hint}</small></span><input type="checkbox" checked={value[overlay.id]} onChange={() => onChange({ ...value, [overlay.id]: !value[overlay.id] })}/><i aria-hidden="true" /></label>)}</div></section>
}
