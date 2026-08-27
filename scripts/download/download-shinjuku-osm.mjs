import { mkdir, writeFile } from 'node:fs/promises'

const endpoint = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const bounds = '35.6500,139.6000,35.7200,139.7800'
const query = `[out:json][timeout:120];
(
  way["highway"]["name"~"甲州街道|新宿通り|国道20号"](${bounds});
  node["railway"="station"]["name"~"新宿|四ツ谷|高井戸"](${bounds});
);
out tags geom;`

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  body: new URLSearchParams({ data: query }),
})
if (!response.ok) throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`)
const payload = await response.json()
const checked = new Date().toISOString().slice(0, 10)

const features = payload.elements.flatMap((element) => {
  const common = {
    id: `osm-${element.type}-${element.id}`,
    name: element.tags?.name ?? element.tags?.['name:ja'] ?? `OSM ${element.id}`,
    aliases: [element.tags?.ref, element.tags?.alt_name].filter(Boolean),
    source: ['OpenStreetMap'],
    source_url: [`https://www.openstreetmap.org/${element.type}/${element.id}`],
    license: 'ODbL 1.0',
    checked,
    confidence: 'high',
    note: 'Current-geography OSM extract; this is not evidence of a historical alignment.',
  }
  if (element.type === 'way' && element.geometry?.length > 1) return [{ type: 'Feature', properties: { ...common, type: 'road', osm_id: element.id, ref: element.tags?.ref }, geometry: { type: 'LineString', coordinates: element.geometry.map(({ lon, lat }) => [lon, lat]) } }]
  if (element.type === 'node' && Number.isFinite(element.lon) && Number.isFinite(element.lat)) return [{ type: 'Feature', properties: { ...common, type: 'station', osm_id: element.id }, geometry: { type: 'Point', coordinates: [element.lon, element.lat] } }]
  return []
})

const collection = { type: 'FeatureCollection', features }
const index = features.map(({ properties, geometry }) => ({ id: properties.id, name: properties.name, aliases: properties.aliases, type: properties.type, center: geometry.type === 'Point' ? geometry.coordinates : undefined }))
await mkdir('public/data/modern', { recursive: true })
await mkdir('public/search', { recursive: true })
await writeFile('public/data/modern/shinjuku-osm.geojson', `${JSON.stringify(collection, null, 2)}\n`)
await writeFile('public/search/modern-shinjuku.json', `${JSON.stringify(index, null, 2)}\n`)
console.log(`Wrote ${features.length} current OSM features checked ${checked}.`)
