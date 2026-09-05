import type { FeatureCollection, Position } from 'geojson'
import type { EntityFeature, EntityProperties } from '../types/geo'
import type { JurisdictionLayerConfig } from './jurisdictions'

export const DEFAULT_PROJECT_ID = 'shinjuku'
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const PROJECT_FILES = ['modern-roads', 'railways', 'railway-routes', 'stations', 'historical-roads', 'historical-posts', 'locations'] as const
export type ProjectFile = typeof PROJECT_FILES[number]
export interface ProjectConfigMetadata { id: string; displayName: string; jurisdictionLayer?: Partial<JurisdictionLayerConfig> }
export interface ProjectManifest { projectId: string; bounds: [number, number, number, number]; featureCounts: Record<string, number> }
export interface ProjectData { config: ProjectConfigMetadata; manifest: ProjectManifest; collections: Record<ProjectFile, FeatureCollection>; searchable: EntityFeature[] }

function lines(feature: EntityFeature): Position[][] {
  if (feature.geometry.type === 'LineString') return [feature.geometry.coordinates]
  return feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
}

function mergedLines(features: EntityFeature[]): Position[][] {
  const seen = new Set<string>()
  return features.flatMap(lines).filter((line) => {
    const key = JSON.stringify(line)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function routeCanonicalId(properties: EntityProperties): string {
  const wikidata = properties.wikidata?.trim()
  if (wikidata) return `wikidata:${wikidata}`
  if (properties.railColorId) return `catalog:${properties.railColorId}`
  return `route:${properties.railRouteId || properties.id}`
}

/** Build one runtime search entity per semantic OSM route identity. */
export function canonicalRailwayRoutes(routes: EntityFeature[]): EntityFeature[] {
  const groups = new Map<string, EntityFeature[]>()
  for (const route of routes) {
    const canonicalId = routeCanonicalId(route.properties)
    groups.set(canonicalId, [...(groups.get(canonicalId) ?? []), route])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([canonicalId, members]) => {
    const ordered = [...members].sort((left, right) => (left.properties.railRouteId || left.properties.id).localeCompare(right.properties.railRouteId || right.properties.id))
    const first = ordered[0]
    const railRouteIds = [...new Set(ordered.map((route) => route.properties.railRouteId || route.properties.id))].sort()
    const colorIds = new Set(ordered.map((route) => route.properties.railColorId).filter(Boolean))
    const aliases = [...new Set(ordered.flatMap(({ properties }) => [properties.name, properties['name:ja'], properties['name:en'], properties.ref, properties.operator, properties.network]).filter((value): value is string => Boolean(value)))]
    const name = (colorIds.size === 1 ? first.properties.railDisplayName : undefined) || first.properties['name:ja'] || first.properties.name || first.properties.ref || railRouteIds[0]
    return { type: 'Feature', properties: { ...first.properties, id: `railway:${canonicalId}`, name, aliases: aliases.filter((alias) => alias !== name), type: 'railway', railCanonicalId: canonicalId, railRouteIds }, geometry: { type: 'MultiLineString', coordinates: mergedLines(ordered) } }
  })
}

/** Conservatively promote only catalog-backed, grouped, orphan physical tracks. */
export function railwaySearchFeatures(collection: FeatureCollection, logicalRoutes: EntityFeature[] = []): EntityFeature[] {
  const representedColors = new Set(logicalRoutes.map((route) => route.properties.railColorId).filter(Boolean))
  const groups = new Map<string, EntityFeature[]>()
  for (const candidate of collection.features as EntityFeature[]) {
    const colorId = candidate.properties.railColorId
    if (!colorId || representedColors.has(colorId) || candidate.properties.railRouteIds?.length) continue
    groups.set(colorId, [...(groups.get(colorId) ?? []), candidate])
  }
  return [...groups.entries()].filter(([, features]) => features.length > 1 || features.some((feature) => feature.geometry.type === 'MultiLineString')).map(([colorId, features]) => {
    const first = [...features].sort((left, right) => left.properties.id.localeCompare(right.properties.id))[0]
    const name = first.properties.railDisplayName || first.properties.name
    return { type: 'Feature', properties: { ...first.properties, id: `railway:catalog:${colorId}`, name, type: 'railway', railCanonicalId: `catalog:${colorId}` }, geometry: { type: 'MultiLineString', coordinates: mergedLines(features) } }
  })
}

export function resolveProjectId(search = typeof window === 'undefined' ? '' : window.location.search): string {
  const selected = new URLSearchParams(search).get('project')
  return selected && PROJECT_ID_PATTERN.test(selected) ? selected : DEFAULT_PROJECT_ID
}

async function getJson<T>(projectId: string, path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}projects/${projectId}/${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export async function loadProject(projectId = resolveProjectId()): Promise<ProjectData> {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`Unsafe project ID: ${projectId}`)
  const [config, manifest, ...loaded] = await Promise.all([getJson<ProjectConfigMetadata>(projectId, 'project.json'), getJson<ProjectManifest>(projectId, 'manifest.json'), ...PROJECT_FILES.map((file) => getJson<FeatureCollection>(projectId, `data/${file}.geojson`))])
  const collections = Object.fromEntries(PROJECT_FILES.map((file, index) => [file, loaded[index]])) as Record<ProjectFile, FeatureCollection>
  const logicalRoutes = collections['railway-routes'].features as EntityFeature[]
  const searchableRoutes = canonicalRailwayRoutes(logicalRoutes)
  const searchable = [...(['modern-roads', 'stations', 'historical-roads', 'historical-posts', 'locations'].flatMap((file) => collections[file as ProjectFile].features) as EntityFeature[]), ...searchableRoutes, ...railwaySearchFeatures(collections.railways, logicalRoutes)]
  return { config, manifest, collections, searchable }
}
