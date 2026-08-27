const datasets = [
  {
    name: 'OpenFreeMap Positron',
    provider: 'OpenFreeMap / OpenStreetMap contributors',
    kind: '実データ・オンラインベクター',
    url: 'https://openfreemap.org/',
  },
  {
    name: '地理院タイル（標準地図）',
    provider: '国土地理院',
    kind: '実データ・オンライン',
    url: 'https://maps.gsi.go.jp/development/ichiran.html',
  },
  {
    name: 'Michi Map v0.1 sample',
    provider: 'Michi Map project',
    kind: '手描きデモ・調査利用不可',
  },
]

export function DataPanel() {
  return <details className="data-panel"><summary>Data / Attribution</summary><div>{datasets.map((dataset) => <p key={dataset.name}><strong>{dataset.name}</strong><span>{dataset.provider} · {dataset.kind}</span>{dataset.url && <a href={dataset.url} target="_blank" rel="noreferrer">配布・利用条件 ↗</a>}</p>)}</div></details>
}
