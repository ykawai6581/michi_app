import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'

interface SearchEntry { id: string }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export async function loadShinjukuEntities(): Promise<EntityFeature[]> {
  const [index, collection] = await Promise.all([
    getJson<SearchEntry[]>('search/modern-shinjuku.json'),
    getJson<FeatureCollection>('data/modern/shinjuku-osm.geojson'),
  ])
  const features = new Map(
    (collection.features as EntityFeature[]).map((feature) => [feature.properties.id, feature]),
  )
  return index.flatMap(({ id }) => {
    const feature = features.get(id)
    return feature ? [feature] : []
  })
}
