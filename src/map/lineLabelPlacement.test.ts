import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { buildLineLabelAnchors, pointAtPolylineMidpoint, uprightBearing } from './lineLabelPlacement'

const map = {
  getCanvas: () => ({ width: 500, height: 300, clientWidth: 500, clientHeight: 300 }),
  project: ([x, y]: [number, number]) => ({ x, y }),
  unproject: ([x, y]: [number, number]) => ({ toArray: () => [x, y] }),
}

function line(id: string, coordinates: number[][], name = '甲州街道', properties = {}): EntityFeature {
  return { type: 'Feature', properties: { id, name, type: 'road', ...properties }, geometry: { type: 'LineString', coordinates } } as EntityFeature
}

describe('selected line label placement', () => {
  it('creates one Point anchor for a visible LineString', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[0, 100], [400, 100]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0]).toMatchObject({ properties: { id: 'A', name: '甲州街道', type: 'road', bearing: 0 }, geometry: { type: 'Point', coordinates: [200, 100] } })
  })

  it('chooses one anchor from the longest component of a MultiLineString', () => {
    const feature = { ...line('A', []), geometry: { type: 'MultiLineString', coordinates: [[[0, 20], [100, 20]], [[0, 200], [400, 200]]] } } as EntityFeature
    const result = buildLineLabelAnchors(map as never, [feature])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([200, 200])
  })

  it('chooses the longest visible fragment across separate pieces with the same id', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[0, 20], [100, 20]]), line('A', [[0, 200], [400, 200]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([200, 200])
  })

  it('omits a line entirely outside the viewport', () => {
    expect(buildLineLabelAnchors(map as never, [line('A', [[-200, -20], [-100, -20]])]).features).toEqual([])
  })

  it('clips a crossing whose endpoints are both outside the viewport', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[-100, 150], [600, 150]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([250, 150])
  })

  it('places a polyline midpoint by cumulative pixel distance rather than coordinate index', () => {
    const result = pointAtPolylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 110, y: 0 }])
    expect(result?.point).toEqual({ x: 55, y: 0 })
  })

  it('normalizes reversed directions so text remains upright', () => {
    expect(uprightBearing({ x: 100, y: 20 }, { x: 0, y: 0 })).toBeCloseTo(11.31, 2)
    expect(uprightBearing({ x: 100, y: 0 }, { x: 0, y: 20 })).toBeCloseTo(-11.31, 2)
  })

  it('allows separate logical ids with the same name to each have a label', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[0, 50], [100, 50]]), line('B', [[0, 100], [100, 100]])])
    expect(result.features.map((feature) => feature.properties.id)).toEqual(['A', 'B'])
  })

  it('copies railway color properties to its anchor', () => {
    const railway = line('rail', [[0, 50], [100, 50]], '中央線', { type: 'railway', railColor: '#123456' })
    expect(buildLineLabelAnchors(map as never, [railway]).features[0].properties).toMatchObject({ type: 'railway', railColor: '#123456' })
  })
})
