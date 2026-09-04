import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { buildLineLabelAnchors as placeLabels, LABEL_FIT_RATIO, LABEL_SAFE_HEIGHT_RATIO, labelFitsFragment, pointAtPolylineMidpoint, uprightBearing } from './lineLabelPlacement'

const map = {
  getCanvas: () => ({ width: 500, height: 300, clientWidth: 500, clientHeight: 300 }),
  project: ([x, y]: [number, number]) => ({ x, y }),
  unproject: ([x, y]: [number, number]) => ({ toArray: () => [x, y] }),
}

const permissivePresentation = { fontSize: 28, haloWidth: 0, measureTextWidth: () => 0 }
const buildLineLabelAnchors = (candidateMap: typeof map, features: EntityFeature[]) => placeLabels(candidateMap as never, features, permissivePresentation)

function line(id: string, coordinates: number[][], name = '甲州街道', properties = {}): EntityFeature {
  return { type: 'Feature', properties: { id, name, type: 'road', ...properties }, geometry: { type: 'LineString', coordinates } } as EntityFeature
}

describe('selected line label placement', () => {
  it('creates exactly one selected anchor for each of three visible scene roads', () => {
    const roads = ['A','B','C'].map((id,index)=>line(id, [[0,50+index*50],[100,50+index*50]], id, { sceneLineState:'selected' }))
    const anchors = buildLineLabelAnchors(map as never, roads).features
    expect(anchors.map(anchor=>anchor.properties.id)).toEqual(['A','B','C'])
    expect(anchors.every(anchor=>anchor.properties.sceneLineState==='selected')).toBe(true)
  })

  it('creates one Point anchor for a visible LineString', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[0, 100], [400, 100]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0]).toMatchObject({ properties: { id: 'A', name: '甲州街道', type: 'road', bearing: 0 }, geometry: { type: 'Point', coordinates: [200, 100] } })
  })

  it('chooses an upper component of a MultiLineString instead of a longer component in the caption zone', () => {
    const feature = { ...line('A', []), geometry: { type: 'MultiLineString', coordinates: [[[0, 20], [100, 20]], [[0, 200], [400, 200]]] } } as EntityFeature
    const result = buildLineLabelAnchors(map as never, [feature])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([50, 20])
  })

  it('chooses a shorter upper fragment when the longest same-id fragment is in the caption zone', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[0, 20], [100, 20]]), line('A', [[0, 200], [400, 200]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([50, 20])
  })

  it('clips a road crossing the caption-safe boundary and anchors above it', () => {
    const result = buildLineLabelAnchors(map as never, [line('crossing', [[250, 100], [250, 260]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates[1]).toBeLessThanOrEqual(300 * LABEL_SAFE_HEIGHT_RATIO)
    expect(result.features[0].geometry.coordinates).toEqual([250, 147.5])
  })

  it('omits a road whose visible geometry is entirely in the caption zone', () => {
    expect(buildLineLabelAnchors(map as never, [line('lower', [[20, 220], [480, 220]])]).features).toEqual([])
  })

  it.each(['selected', 'retained'] as const)('keeps %s state labels in the caption-safe region', (sceneLineState) => {
    const anchor = buildLineLabelAnchors(map as never, [line(sceneLineState, [[10, 180], [490, 220]], sceneLineState, { sceneLineState })]).features[0]
    expect(anchor.properties.sceneLineState).toBe(sceneLineState)
    expect(anchor.geometry.coordinates[1]).toBeLessThanOrEqual(300 * LABEL_SAFE_HEIGHT_RATIO)
  })

  it('omits a line entirely outside the viewport', () => {
    expect(buildLineLabelAnchors(map as never, [line('A', [[-200, -20], [-100, -20]])]).features).toEqual([])
  })

  it('clips a crossing whose endpoints are both outside the viewport', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[-100, 150], [600, 150]])])
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.coordinates).toEqual([250, 150])
  })

  it('still anchors a briefly visible fragment at the viewport edge', () => {
    const result = buildLineLabelAnchors(map as never, [line('short', [[-2, 150], [3, 150]])])
    expect(result.features.map(feature=>feature.properties.id)).toEqual(['short'])
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
    expect(new Set(result.features.map(feature=>feature.properties.id)).size).toBe(result.features.length)
  })

  it('copies railway color properties to its anchor', () => {
    const railway = line('rail', [[0, 50], [100, 50]], '中央線', { type: 'railway', railColor: '#123456' })
    expect(buildLineLabelAnchors(map as never, [railway]).features[0].properties).toMatchObject({ type: 'railway', railColor: '#123456' })
  })

  it('shows a long fragment and suppresses one shorter than its measured label threshold', () => {
    const presentation = { fontSize: 20, haloWidth: 2, measureTextWidth: () => 100 }
    expect(placeLabels(map as never, [line('long', [[0, 100], [200, 100]])], presentation).features).toHaveLength(1)
    expect(placeLabels(map as never, [line('short', [[0, 100], [130, 100]])], presentation).features).toHaveLength(0)
  })

  it('uses the exact centralized fit ratio', () => {
    const presentation = { fontSize: 20, haloWidth: 0, measureTextWidth: () => 100 }
    expect(labelFitsFragment(100 * LABEL_FIT_RATIO, 'road', presentation)).toBe(true)
    expect(labelFitsFragment(100 * LABEL_FIT_RATIO - 0.01, 'road', presentation)).toBe(false)
  })

  it('responds to projected screen scale without a zoom threshold', () => {
    const feature = line('scaled', [[0, 100], [100, 100]], 'Road')
    const presentation = { fontSize: 20, haloWidth: 0, measureTextWidth: () => 60 }
    const atScale = (scale: number) => ({ ...map, project: ([x,y]: [number,number]) => ({ x:x*scale, y }) })
    expect(placeLabels(atScale(1) as never, [feature], presentation).features).toHaveLength(1)
    expect(placeLabels(atScale(0.5) as never, [feature], presentation).features).toHaveLength(0)
  })

  it('clips to the top safe region before testing fit', () => {
    const presentation = { fontSize: 20, haloWidth: 0, measureTextWidth: () => 50 }
    const crossing = line('crossing-fit', [[250, 170], [250, 400]], 'Road')
    expect(placeLabels(map as never, [crossing], presentation).features).toHaveLength(0)
  })

  it('includes both halo sides in the required width', () => {
    const presentation = { fontSize: 20, haloWidth: 10, measureTextWidth: () => 80 }
    expect(labelFitsFragment(80 * LABEL_FIT_RATIO, 'Road', presentation)).toBe(false)
    expect(labelFitsFragment(100 * LABEL_FIT_RATIO, 'Road', presentation)).toBe(true)
  })

  it('uses presentation-scaled font size for measurement', () => {
    const measuredSizes: number[] = []
    const measureTextWidth = (_label: string, size: number) => { measuredSizes.push(size); return size * 4 }
    expect(labelFitsFragment(105, 'Road', { fontSize: 20, haloWidth: 0, measureTextWidth })).toBe(true)
    expect(labelFitsFragment(105, 'Road', { fontSize: 40, haloWidth: 0, measureTextWidth })).toBe(false)
    expect(measuredSizes).toEqual([20, 40])
  })

  it('tests the longest eligible MultiLineString fragment', () => {
    const feature = { ...line('multi', []), geometry: { type:'MultiLineString', coordinates:[[[0,50],[60,50]],[[0,100],[180,100]]] } } as EntityFeature
    const result = placeLabels(map as never, [feature], { fontSize:20, haloWidth:0, measureTextWidth:()=>100 })
    expect(result.features[0].geometry.coordinates).toEqual([90,100])
  })

  it.each(['selected', 'active', 'retained'] as const)('does not let %s selection state change fit', (sceneLineState) => {
    const feature = line(sceneLineState, [[0,100],[100,100]], 'Road', { sceneLineState })
    expect(placeLabels(map as never, [feature], { fontSize:20, haloWidth:0, measureTextWidth:()=>80 }).features).toHaveLength(0)
  })
})
