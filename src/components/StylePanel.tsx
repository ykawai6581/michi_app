import type { HighlightStyle } from '../types/geo'

const colors: { key: 'roadColor' | 'locationColor' | 'stationColor' | 'shukubaColor' | 'regionColor'; label: string }[] = [
  { key: 'roadColor', label: 'Road' },
  { key: 'locationColor', label: 'Location' },
  { key: 'stationColor', label: 'Station' },
  { key: 'shukubaColor', label: 'Shukuba' },
  { key: 'regionColor', label: 'Region' },
]

export function StylePanel({ value, onChange }: { value: HighlightStyle; onChange: (value: HighlightStyle) => void }) {
  return <section className="panel-section"><div className="section-heading"><span className="eyebrow">HIGHLIGHT</span><h2>強調スタイル</h2></div><div className="category-colors">{colors.map(({ key, label }) => <label key={key}><span>{label}</span><code>{value[key].toUpperCase()}</code><input aria-label={`${label}の強調色`} type="color" value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })}/></label>)}</div><label className="range-label"><span>線の太さ <b>{value.width}px</b></span><input type="range" min="2" max="16" value={value.width} onChange={(event) => onChange({ ...value, width: Number(event.target.value) })}/></label><label className="range-label"><span>透明度 <b>{Math.round(value.opacity * 100)}%</b></span><input type="range" min="20" max="100" value={value.opacity * 100} onChange={(event) => onChange({ ...value, opacity: Number(event.target.value) / 100 })}/></label><span className="option-label">Annotation size</span><div className="size-options"><label><input type="radio" name="annotation-size" checked={value.annotationSize === 'normal'} onChange={() => onChange({ ...value, annotationSize: 'normal' })}/><span>標準 14px</span></label><label><input type="radio" name="annotation-size" checked={value.annotationSize === 'large'} onChange={() => onChange({ ...value, annotationSize: 'large' })}/><span>大 28px</span></label></div><div className="highlight-options"><label><input type="checkbox" checked={value.glow} onChange={() => onChange({ ...value, glow: !value.glow })}/><span>Glow</span></label><label><input type="checkbox" checked={value.animate} onChange={() => onChange({ ...value, animate: !value.animate })}/><span>描画animation</span></label></div></section>
}
