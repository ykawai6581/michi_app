import { useMemo, useState } from 'react'
import { entities } from '../data/sample'
import { searchEntities } from '../search/search'
import type { EntityFeature } from '../types/geo'

const typeNames: Record<string,string> = { road:'現代道路','historical-road':'歴史街道',place:'現代地名','historical-place':'宿場・歴史地名',chome:'町丁目' }
export function SearchPanel({ onSelect }: { onSelect: (feature: EntityFeature) => void }) {
  const [query,setQuery] = useState(''); const results = useMemo(() => searchEntities(entities,query),[query])
  return <section className="panel-section search-section"><div className="section-heading"><span className="eyebrow">FIND</span><h2>地物を探す</h2></div><label htmlFor="search" className="sr-only">道路・地名・町丁目を検索</label><div className="search-box"><span aria-hidden="true">⌕</span><input id="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="甲州街道、新宿一丁目…" autoComplete="off" /></div>
  {query && <div className="search-results" aria-live="polite">{results.length ? results.map((f)=><button className="result" key={f.properties.id} onClick={()=>onSelect(f)}><span><strong>{f.properties.name}</strong><small>{typeNames[f.properties.type] ?? f.properties.type}</small></span><span className="arrow">→</span>{f.properties.aliases?.length ? <em>{f.properties.aliases.join('・')}</em>:null}</button>):<p className="empty">一致する地物がありません</p>}</div>}
  {!query && <div className="suggestions"><span>試す</span>{['甲州街道','新宿','新宿一丁目'].map(q=><button key={q} onClick={()=>setQuery(q)}>{q}</button>)}</div>}</section>
}
