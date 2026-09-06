import { describe, expect, it } from 'vitest'
import type { EntityFeature, MapEntityType, SceneItem } from '../types/geo'
import { clearTemporarySceneItems, removeTemporarySceneItem, seedProjectRoads } from './items'

const feature = (id: string, type: MapEntityType): EntityFeature => ({
  type: 'Feature', properties: { id, name: id, type }, geometry: { type: 'Point', coordinates: [139, 35] },
})

describe('project-backed scene items', () => {
  it('seeds every project road hidden and excludes other project entities', () => {
    const items = seedProjectRoads([feature('road', 'road'), feature('old-road', 'historical-road'), feature('station', 'station')])
    expect(items.map((item) => item.feature.properties.id)).toEqual(['road', 'old-road'])
    expect(items.every((item) => item.projectBacked && !item.visible)).toBe(true)
  })

  it('does not duplicate project roads when refreshed', () => {
    const road = feature('road', 'road')
    const first = seedProjectRoads([road])
    first[0].visible = true
    expect(seedProjectRoads([road], first)).toEqual([{ feature: road, visible: true, projectBacked: true }])
  })

  it('clear and delete preserve project roads while removing temporary items', () => {
    const projectItem = seedProjectRoads([feature('road', 'road')])[0]
    const temporary: SceneItem = { feature: feature('station', 'station'), visible: true }
    expect(clearTemporarySceneItems([projectItem, temporary])).toEqual([projectItem])
    expect(removeTemporarySceneItem([projectItem, temporary], 'road')).toEqual([projectItem, temporary])
    expect(removeTemporarySceneItem([projectItem, temporary], 'station')).toEqual([projectItem])
  })
})
