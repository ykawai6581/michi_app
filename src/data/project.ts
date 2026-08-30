import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'

export const DEFAULT_PROJECT_ID = 'shinjuku'
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const PROJECT_FILES = ['modern-roads', 'railways', 'stations', 'historical-roads', 'historical-posts'] as const
export type ProjectFile = typeof PROJECT_FILES[number]
export interface ProjectManifest { projectId: string; bounds: [number, number, number, number]; featureCounts: Record<string, number> }
export interface ProjectData { manifest: ProjectManifest; collections: Record<ProjectFile, FeatureCollection>; searchable: EntityFeature[] }

export function railwaySearchFeatures(collection: FeatureCollection): EntityFeature[] {
  const groups = new Map<string, EntityFeature[]>()
  for (const candidate of collection.features as EntityFeature[]) {
    const id = candidate.properties.railGroupId
    if (id) groups.set(id, [...(groups.get(id) ?? []), candidate])
  }
  return [...groups].map(([id, features]) => ({ type:'Feature', properties:{
    ...features[0].properties, id, name:features[0].properties.railDisplayName ?? features[0].properties.name, type:'railway' as const,
  }, geometry:{ type:'MultiLineString', coordinates:features.flatMap((feature) => feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : []) } }))
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
  const [manifest, ...loaded] = await Promise.all([getJson<ProjectManifest>(projectId, 'manifest.json'), ...PROJECT_FILES.map((file) => getJson<FeatureCollection>(projectId, `data/${file}.geojson`))])
  const collections = Object.fromEntries(PROJECT_FILES.map((file, index) => [file, loaded[index]])) as Record<ProjectFile, FeatureCollection>
  const searchable = [...(['modern-roads', 'stations', 'historical-roads', 'historical-posts'].flatMap((file) => collections[file as ProjectFile].features) as EntityFeature[]), ...railwaySearchFeatures(collections.railways)]
  return { manifest, collections, searchable }
}
