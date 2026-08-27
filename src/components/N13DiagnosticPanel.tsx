import type { DiagnosticVisibility } from '../map/layers'

const modes: { id: keyof DiagnosticVisibility; name: string; detail: string; count: string }[] = [
  { id: 'osmSource', name: 'OSM 元セグメント', detail: 'マゼンタ・破線', count: '124 features' },
  { id: 'osmDerived', name: 'OSM 論理道路', detail: '青・細線', count: 'derived line' },
  { id: 'n13', name: 'N13 候補中心線', detail: '緑・実線', count: '2,249 features' },
]

export function N13DiagnosticPanel({ value, onChange }: { value: DiagnosticVisibility; onChange: (value: DiagnosticVisibility) => void }) {
  return <section className="panel-section diagnostic-panel"><div className="section-heading"><span className="eyebrow">TEMPORARY DIAGNOSTIC</span><h2>甲州街道・形状比較</h2></div><p className="diagnostic-warning">N13 は OSM から約100 m以内の全候補です。甲州街道と未判定の近隣道路を含みます。</p><div className="diagnostic-modes">{modes.map((mode) => <label key={mode.id}><input type="checkbox" checked={value[mode.id]} onChange={() => onChange({ ...value, [mode.id]: !value[mode.id] })}/><i className={mode.id} aria-hidden="true"/><span><strong>{mode.name}</strong><small>{mode.detail} · {mode.count}</small></span></label>)}</div><details><summary>N13 属性例</summary><code>N13_001–N13_008</code><span>michi_match: koshu_osm_corridor</span><span>michi_buffer_m: 100</span></details></section>
}
