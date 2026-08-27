import { mkdir, writeFile } from 'node:fs/promises'

const defaultEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const endpoints = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : defaultEndpoints
const bounds = '35.6500,139.6000,35.7200,139.7800'
const query = `[out:json][timeout:120];
(
  way["highway"]["name"~"甲州街道|新宿通り|国道20号"](${bounds});
  node["railway"="station"]["name"~"新宿|四ツ谷|高井戸"](${bounds});
);
out tags geom;`

async function requestOverpass() {
  const failures = []
  for (const endpoint of endpoints) {
    const url = new URL(endpoint)
    url.searchParams.set('data', query)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'michi-map-data-pipeline/0.1 (+https://github.com/ykawai6581/michi_app)',
        },
      })
      if (response.ok) return response
      const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240)
      failures.push(`${endpoint}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`)
    } catch (error) {
      failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Every Overpass endpoint failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
}

const response = await requestOverpass()
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
