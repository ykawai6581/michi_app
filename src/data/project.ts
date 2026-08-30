import type { FeatureCollection } from 'geojson'
import type { EntityFeature } from '../types/geo'

export const PROJECT_ID = 'shinjuku'
export const PROJECT_FILES = ['modern-roads', 'railways', 'stations', 'historical-roads', 'historical-posts'] as const
export type ProjectFile = typeof PROJECT_FILES[number]
export interface ProjectManifest { projectId: string; bounds: [number, number, number, number]; featureCounts: Record<string, number> }
export interface ProjectData { manifest: ProjectManifest; collections: Record<ProjectFile, FeatureCollection>; searchable: EntityFeature[] }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}projects/${PROJECT_ID}/${path}`)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export async function loadProject(): Promise<ProjectData> {
  const [manifest, ...loaded] = await Promise.all([getJson<ProjectManifest>('manifest.json'), ...PROJECT_FILES.map((file) => getJson<FeatureCollection>(`data/${file}.geojson`))])
  const collections = Object.fromEntries(PROJECT_FILES.map((file, index) => [file, loaded[index]])) as Record<ProjectFile, FeatureCollection>
  const searchable = ['modern-roads', 'stations', 'historical-roads', 'historical-posts'].flatMap((file) => collections[file as ProjectFile].features) as EntityFeature[]
  return { manifest, collections, searchable }
}
