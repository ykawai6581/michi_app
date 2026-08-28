import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'

interface SearchEntry { id: string }
interface RoadSearchEntry extends SearchEntry { name: string; aliases: string[]; sources: { n13: string; osm: string } }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export async function loadShinjukuEntities(): Promise<EntityFeature[]> {
  const [index, rawCollection, roadIndex] = await Promise.all([
    getJson<SearchEntry[]>('search/modern-shinjuku.json'),
    getJson<FeatureCollection>('data/modern/shinjuku-osm.geojson'),
    getJson<RoadSearchEntry[]>('search/roads.json'),
  ])
  const rawFeatures = rawCollection.features as EntityFeature[]
  const features = new Map(rawFeatures.map((feature) => [feature.properties.id, feature]))
  const nonRoads = index.flatMap(({ id }): EntityFeature[] => {
    const feature = features.get(id)
    if (!feature || feature.properties.type === 'road') return []
    return [feature]
  })
  const canonicalRoads = await Promise.all(roadIndex.map(async (entry) => {
    try {
      const [n13, osm] = await Promise.all([getJson<FeatureCollection>(entry.sources.n13), getJson<FeatureCollection>(entry.sources.osm)])
      const feature = n13.features[0] as EntityFeature
      return { ...feature, properties: { ...feature.properties, id: entry.id, name: entry.name, aliases: entry.aliases, type: 'road', roadSourceGeometries: { n13: feature.geometry, osm: osm.features[0].geometry } } } as EntityFeature
    } catch {
      return undefined
    }
  }))
  return [...canonicalRoads.filter((road): road is EntityFeature => road !== undefined), ...nonRoads]
}
