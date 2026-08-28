import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadShinjukuEntities } from './shinjuku'

afterEach(() => vi.unstubAllGlobals())

describe('canonical road loading', () => {
  it('resolves both source geometries from roads.json without road-specific code', async () => {
    const responses: Record<string, unknown> = {
      'search/modern-shinjuku.json': [],
      'data/modern/shinjuku-osm.geojson': { type: 'FeatureCollection', features: [] },
      'search/roads.json': [{ id: 'future-road', name: 'Future Road', aliases: [], sources: { n13: 'n13.geojson', osm: 'osm.geojson' } }],
      'n13.geojson': { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } }] },
      'osm.geojson': { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[3, 3], [4, 4]] } }] },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => responses[url.replace(/^\//, '')] })))
    const [road] = await loadShinjukuEntities()
    expect(road.properties.id).toBe('future-road')
    expect(road.properties.roadSourceGeometries?.n13).toEqual(road.geometry)
    expect(road.properties.roadSourceGeometries?.osm).toMatchObject({ coordinates: [[3, 3], [4, 4]] })
  })
})
