import type { BasemapMode, LayerVisibility } from '../types/geo'

const basemaps: { id: BasemapMode; name: string; hint: string }[] = [
  { id: 'presentation', name: 'Presentation', hint: 'ベクター' },
  { id: 'dark', name: 'Dark', hint: '夜間・高contrast' },
  { id: 'gsi', name: '地理院地図', hint: '詳細' },
  { id: 'white', name: '白背景', hint: '素材用' },
  { id: 'transparent', name: '透明', hint: '合成用' },
]

const overlays: { id: Exclude<keyof LayerVisibility, 'basemap'>; name: string; hint: string }[] = [
  { id: 'roads', name: '現代道路', hint: 'デモ' },
  { id: 'historicalRoads', name: '江戸街道', hint: 'デモ' },
  { id: 'places', name: '宿場・地名', hint: 'デモ' },
  { id: 'chome', name: '町丁目', hint: 'デモ' },
]

export function LayerPanel({ value, onChange }: { value: LayerVisibility; onChange: (value: LayerVisibility) => void }) {
  return <section className="panel-section"><div className="section-heading"><span className="eyebrow">BASEMAP</span><h2>背景地図</h2></div><div className="basemap-grid">{basemaps.map((basemap) => <label className="basemap-option" key={basemap.id}><input type="radio" name="basemap" checked={value.basemap === basemap.id} onChange={() => onChange({ ...value, basemap: basemap.id })}/><span><strong>{basemap.name}</strong><small>{basemap.hint}</small></span></label>)}</div><div className="section-heading overlay-heading"><span className="eyebrow">OVERLAYS</span><h2>重ねる情報</h2></div><div className="layer-list">{overlays.map((overlay) => <label className="layer-row" key={overlay.id}><span className={`layer-swatch ${overlay.id}`} /><span><strong>{overlay.name}</strong><small>{overlay.hint}</small></span><input type="checkbox" checked={value[overlay.id]} onChange={() => onChange({ ...value, [overlay.id]: !value[overlay.id] })}/><i aria-hidden="true" /></label>)}</div></section>
}
