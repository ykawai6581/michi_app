import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { splitRoadSourceFeatures } from './highlight'

const road = { type: 'Feature', properties: { id: 'road', name: 'Road', type: 'road', roadSourceGeometries: { n13: { type: 'LineString', coordinates: [[0, 0], [1, 0]] }, osm: { type: 'LineString', coordinates: [[0, 1], [1, 1]] } } }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } } as EntityFeature

describe('canonical road source visibility', () => {
  it.each([
    [{ n13: true, osm: false }, 1, 0],
    [{ n13: false, osm: true }, 0, 1],
    [{ n13: true, osm: true }, 1, 1],
    [{ n13: false, osm: false }, 0, 0],
  ] as const)('splits N13=%s and OSM source features independently', (visibility, primary, osm) => {
    const result = splitRoadSourceFeatures([road], visibility)
    expect([result.primary.length, result.osm.length]).toEqual([primary, osm])
  })
})
