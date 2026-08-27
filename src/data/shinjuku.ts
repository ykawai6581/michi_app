import type { FeatureCollection, Position } from 'geojson'
import type { EntityFeature } from '../types/geo'
import { normalizeJapanese } from '../search/normalizeJapanese'

interface SearchEntry { id: string }

const CENTERLINE_SAMPLE_METERS = 15
const CENTERLINE_BIN_METERS = 30

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function deriveCenterline(segments: EntityFeature[]): Position[] {
  const lines = segments.flatMap(({ geometry }) => {
    if (geometry.type === 'LineString') return [geometry.coordinates]
    if (geometry.type === 'MultiLineString') return geometry.coordinates
    return []
  })
  const coordinates = lines.flat()
  if (coordinates.length < 2) return coordinates
  const referenceLatitude = coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length
  const referenceLongitude = coordinates.reduce((sum, point) => sum + point[0], 0) / coordinates.length
  const longitudeScale = 111_320 * Math.cos(referenceLatitude * Math.PI / 180)
  const toMeters = (point: Position): Position => [(point[0] - referenceLongitude) * longitudeScale, (point[1] - referenceLatitude) * 110_540]
  const samples = lines.flatMap((line) => line.slice(1).flatMap((point, index) => {
    const from = toMeters(line[index]); const to = toMeters(point)
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const count = Math.max(1, Math.ceil(length / CENTERLINE_SAMPLE_METERS))
    return Array.from({ length: count }, (_, sample) => {
      const amount = sample / count
      return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount]
    })
  }).concat(lines.map((line) => toMeters(line[line.length - 1]))))
  const meanX = samples.reduce((sum, point) => sum + point[0], 0) / samples.length
  const meanY = samples.reduce((sum, point) => sum + point[1], 0) / samples.length
  const covarianceXX = samples.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0)
  const covarianceYY = samples.reduce((sum, point) => sum + (point[1] - meanY) ** 2, 0)
  const covarianceXY = samples.reduce((sum, point) => sum + (point[0] - meanX) * (point[1] - meanY), 0)
  const angle = Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY) / 2
  const axis = [Math.cos(angle), Math.sin(angle)]
  const projected = samples.map((point) => ({ point, distance: (point[0] - meanX) * axis[0] + (point[1] - meanY) * axis[1] }))
  const minimum = Math.min(...projected.map(({ distance }) => distance))
  const bins = new Map<number, Position[]>()
  projected.forEach(({ point, distance }) => {
    const bin = Math.floor((distance - minimum) / CENTERLINE_BIN_METERS)
    bins.set(bin, [...(bins.get(bin) ?? []), point])
  })
  const centerline = [...bins.entries()].sort(([left], [right]) => left - right)
    .map(([, points]) => [median(points.map((point) => point[0])), median(points.map((point) => point[1]))])
  const smoothed = centerline.map((_, index) => {
    const neighborhood = centerline.slice(Math.max(0, index - 1), index + 2)
    return [neighborhood.reduce((sum, item) => sum + item[0], 0) / neighborhood.length, neighborhood.reduce((sum, item) => sum + item[1], 0) / neighborhood.length]
  })
  return smoothed.map((point) => [point[0] / longitudeScale + referenceLongitude, point[1] / 110_540 + referenceLatitude])
}

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
    const coordinates = deriveCenterline(segments)
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
        illustrationWidthScale: 1.8,
      },
      geometry: { type: 'LineString' as const, coordinates },
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
