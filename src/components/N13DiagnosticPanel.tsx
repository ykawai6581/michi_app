import type { DiagnosticVisibility } from '../map/layers'

const baseModes: { id: keyof DiagnosticVisibility; name: string; detail: string; count: string }[] = [
  { id: 'osmSource', name: 'OSM 元セグメント', detail: 'マゼンタ・破線', count: '124 features' },
  { id: 'osmDerived', name: 'OSM 論理道路', detail: '青・細線', count: 'derived line' },
  { id: 'n13', name: 'N13 国道中心線', detail: '残差別色分け', count: 'loading' },
]

export function N13DiagnosticPanel({ value, onChange, featureCount, generated }: { value: DiagnosticVisibility; onChange: (value: DiagnosticVisibility) => void; featureCount: number; generated: boolean }) {
  const modes = baseModes.map((mode) => mode.id === 'n13' ? { ...mode, count: `${featureCount.toLocaleString()} features` } : mode)
  return <section className="panel-section diagnostic-panel"><div className="section-heading"><span className="eyebrow">TEMPORARY DIAGNOSTIC</span><h2>国道20号・残差比較</h2></div><p className="diagnostic-warning">{generated ? 'N13_003=1 の全線です。緑ほど OSM 国道20号への中央値残差が小さく、灰色ほど遠い道路です。' : '生成済み診断が見つからないため、旧100 m候補を表示中です。先に診断スクリプトを実行してください。'}</p><div className="diagnostic-modes">{modes.map((mode) => <label key={mode.id}><input type="checkbox" checked={value[mode.id]} onChange={() => onChange({ ...value, [mode.id]: !value[mode.id] })}/><i className={mode.id} aria-hidden="true"/><span><strong>{mode.name}</strong><small>{mode.detail} · {mode.count}</small></span></label>)}</div><details><summary>残差の色</summary><span>濃緑: 0–10 m</span><span>黄緑: 10–20 m</span><span>橙: 20–50 m</span><span>灰: 50 m以上</span><code>route20_median_m</code><span>表示色は診断用で、選択閾値ではありません。</span></details></section>
}
