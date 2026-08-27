import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { mergeRoadEntities } from './shinjuku'

const road = (id: string, aliases: string[], coordinates: [number, number][], name = '甲州街道'): EntityFeature => ({
  type: 'Feature',
  properties: { id, name, aliases, type: 'road', source_url: [`https://example.com/${id}`] },
  geometry: { type: 'LineString', coordinates },
})

describe('Shinjuku road entities', () => {
  it('combines named segments and both directions into one searchable road', () => {
    const result = mergeRoadEntities([
      road('eastbound', ['20'], [[139.7, 35.6], [139.8, 35.6]]),
      road('westbound', ['20'], [[139.8, 35.61], [139.7, 35.61]], '新宿通り'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].properties.aliases).toEqual(['20'])
    expect(result[0].properties.source_url).toHaveLength(2)
    expect(result[0].properties.illustrationWidthScale).toBe(1.8)
    expect(result[0].geometry.type).toBe('LineString')
    if (result[0].geometry.type !== 'LineString') throw new Error('Expected a derived centerline')
    expect(result[0].geometry.coordinates.length).toBeGreaterThan(2)
    expect(result[0].geometry.coordinates.every((coordinate) => coordinate[1] > 35.6 && coordinate[1] < 35.61)).toBe(true)
  })
})
