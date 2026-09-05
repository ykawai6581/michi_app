import type { ProjectData } from '../data/project'
import type { EntityFeature } from '../types/geo'

export function findProjectFeatureById(project: ProjectData, id: string): EntityFeature {
  const feature = project.searchable.find((candidate) => candidate.properties.id === id)
  if (!feature) throw new Error(`Story feature not found: ${id}`)
  return feature
}
