import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'
import { buildLogicalRoadEntities } from '../road-network/coins'

interface SearchEntry { id: string }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export async function loadShinjukuEntities(): Promise<EntityFeature[]> {
  const [index, rawCollection] = await Promise.all([
    getJson<SearchEntry[]>('search/modern-shinjuku.json'),
    getJson<FeatureCollection>('data/modern/shinjuku-osm.geojson'),
  ])
  const rawFeatures = rawCollection.features as EntityFeature[]
  const features = new Map(rawFeatures.map((feature) => [feature.properties.id, feature]))
  const nonRoads = index.flatMap(({ id }): EntityFeature[] => {
    const feature = features.get(id)
    if (!feature || feature.properties.type === 'road') return []
    return [feature]
  })
  return [...buildLogicalRoadEntities(rawFeatures, ['甲州街道', '新宿通り']), ...nonRoads]
}
