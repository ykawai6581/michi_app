import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'
import { normalizeJapanese } from '../search/normalizeJapanese'

interface SearchEntry { id: string }

export function mergeRoadEntities(entities: EntityFeature[]): EntityFeature[] {
  const nonRoads = entities.filter(({ properties }) => properties.type !== 'road')
  let roadGroups: { segments: EntityFeature[]; terms: Set<string> }[] = []
  entities.filter(({ properties }) => properties.type === 'road').forEach((road) => {
    const terms = new Set([road.properties.name, ...(road.properties.aliases ?? [])].map(normalizeJapanese))
    const connected = roadGroups.filter((group) => [...terms].some((term) => group.terms.has(term)))
    roadGroups = roadGroups.filter((group) => !connected.includes(group))
    roadGroups.push({
      segments: [...connected.flatMap(({ segments }) => segments), road],
      terms: new Set([...terms, ...connected.flatMap(({ terms: groupTerms }) => [...groupTerms])]),
    })
  })
  const roads = roadGroups.map(({ segments }) => {
    const first = segments[0]
    const key = normalizeJapanese(first.properties.name)
    const coordinates = segments.flatMap(({ geometry }) => {
      if (geometry.type === 'LineString') return [geometry.coordinates]
      if (geometry.type === 'MultiLineString') return geometry.coordinates
      return []
    })
    const unique = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))]
    return {
      type: 'Feature' as const,
      properties: {
        ...first.properties,
        id: `merged-road-${key}`,
        aliases: unique(segments.flatMap(({ properties }) => [properties.name, ...(properties.aliases ?? [])]))
          .filter((alias) => normalizeJapanese(alias) !== key),
        source: unique(segments.flatMap(({ properties }) => properties.source ?? [])),
        source_url: unique(segments.flatMap(({ properties }) => properties.source_url ?? [])),
      },
      geometry: { type: 'MultiLineString' as const, coordinates },
    }
  })
  return [...roads, ...nonRoads]
}

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
  const indexedEntities = index.flatMap(({ id }) => {
    const feature = features.get(id)
    return feature ? [feature] : []
  })
  return mergeRoadEntities(indexedEntities)
}
