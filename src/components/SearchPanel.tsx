import { useMemo, useState } from 'react'
import { entities } from '../data/sample'
import { searchEntities } from '../search/search'
import type { EntityFeature, MapEntityType } from '../types/geo'

const typeNames: Record<string, string> = { road: '現代道路', 'historical-road': '歴史街道', place: '現代地名', 'historical-place': '宿場・歴史地名', chome: '町丁目' }
const depth: Record<MapEntityType, number> = { chome: 0, water: 0, 'terrain-feature': 0, road: 1, 'historical-road': 1, railway: 1, river: 1, place: 2, 'historical-place': 2, station: 2, custom: 2 }

export function SearchPanel({ selected, onToggle }: { selected: EntityFeature[]; onToggle: (feature: EntityFeature) => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchEntities(entities, query), [query])
  const selectedIds = new Set(selected.map((feature) => feature.properties.id))
  const orderedSelection = [...selected].sort((left, right) => depth[left.properties.type] - depth[right.properties.type])
  return <section className="panel-section search-section"><div className="section-heading"><span className="eyebrow">FIND</span><h2>地物を探す</h2></div><label htmlFor="search" className="sr-only">道路・地名・町丁目を検索</label><div className="search-box"><span aria-hidden="true">⌕</span><input id="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="甲州街道、新宿一丁目…" autoComplete="off" /></div>{query && <div className="search-results" aria-live="polite">{results.length ? results.map((feature) => { const active = selectedIds.has(feature.properties.id); return <button className={`result ${active ? 'active' : ''}`} key={feature.properties.id} onClick={() => onToggle(feature)} aria-pressed={active}><i className="result-check" aria-hidden="true">{active ? '✓' : ''}</i><span><strong>{feature.properties.name}</strong><small>{typeNames[feature.properties.type] ?? feature.properties.type}</small></span>{feature.properties.aliases?.length ? <em>{feature.properties.aliases.join('・')}</em> : null}</button> }) : <p className="empty">一致する地物がありません</p>}</div>}{!query && <div className="suggestions"><span>試す</span>{['甲州街道', '新宿', '新宿一丁目'].map((suggestion) => <button key={suggestion} onClick={() => setQuery(suggestion)}>{suggestion}</button>)}</div>}{orderedSelection.length > 0 && <div className="selected-layers"><span className="eyebrow">SELECTED LAYERS · 下から面 → 線 → 点</span>{orderedSelection.map((feature) => <label key={feature.properties.id}><input type="checkbox" checked onChange={() => onToggle(feature)}/><i aria-hidden="true">✓</i><span><strong>{feature.properties.name}</strong><small>{typeNames[feature.properties.type]}</small></span></label>)}</div>}</section>
}
