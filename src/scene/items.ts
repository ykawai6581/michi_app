import type { EntityFeature, SceneItem } from '../types/geo'

const isRoad = (feature: EntityFeature) => feature.properties.type === 'road' || feature.properties.type === 'historical-road'

export function seedProjectRoads(features: EntityFeature[], current: SceneItem[] = []): SceneItem[] {
  const projectRoads = new Map(features.filter(isRoad).map((feature) => [feature.properties.id, feature]))
  const existing = new Map(current.map((item) => [item.feature.properties.id, item]))
  const temporary = current.filter((item) => !item.projectBacked && !projectRoads.has(item.feature.properties.id))
  return [
    ...Array.from(projectRoads.values(), (feature) => ({ feature, visible: existing.get(feature.properties.id)?.visible ?? false, projectBacked: true })),
    ...temporary,
  ]
}

export function clearTemporarySceneItems(items: SceneItem[]): SceneItem[] {
  return items.filter((item) => item.projectBacked)
}

export function removeTemporarySceneItem(items: SceneItem[], id: string): SceneItem[] {
  return items.filter((item) => item.feature.properties.id !== id || item.projectBacked)
}
