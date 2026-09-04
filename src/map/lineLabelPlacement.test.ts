import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { buildLineLabelAnchors, followRoadPositionAtFraction, LABEL_SAFE_HEIGHT_RATIO, pointAtPolylineMidpoint, uprightBearing } from './lineLabelPlacement'

const map = {
  getCanvas: () => ({ width: 500, height: 300, clientWidth: 500, clientHeight: 300 }),
  project: ([x, y]: [number, number]) => ({ x, y }),
  unproject: ([x, y]: [number, number]) => ({ toArray: () => [x, y] }),
}

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

  it('still anchors a briefly visible fragment at the viewport edge without fit presentation', () => {
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
})

describe('zoom-dependent label fit with visual continuity', () => {
  const presentation = { fontSize: 20, haloWidth: 3, presentationScale: 1, measureTextWidth: () => 120 }

  it('suppresses a genuinely short road when its safe visible chain cannot fit the label', () => {
    const result = buildLineLabelAnchors(map as never, [line('short', [[40, 100], [140, 100]])], presentation)
    expect(result.features).toEqual([])
  })

  it('keeps a single road fragment when it is long enough for the rendered label', () => {
    const result = buildLineLabelAnchors(map as never, [line('long', [[40, 100], [240, 100]])], presentation)
    expect(result.features.map((feature) => feature.properties.id)).toEqual(['long'])
  })

  it('stitches visually continuous same-id pieces before deciding whether the label fits', () => {
    const pieces = [
      line('aratama', [[40, 100], [100, 100]], '荒玉水道道路'),
      line('aratama', [[106, 100], [166, 100]], '荒玉水道道路'),
      line('aratama', [[172, 100], [232, 100]], '荒玉水道道路'),
    ]
    const result = buildLineLabelAnchors(map as never, pieces, presentation)
    expect(result.features.map((feature) => feature.properties.id)).toEqual(['aratama'])
  })
})

describe('average-direction label orientation', () => {
  it('keeps a steep straight road aligned instead of rejecting angles above 40 degrees', () => {
    const chain = [[{ x: 100, y: 180 }, { x: 180, y: 20 }]]
    const position = followRoadPositionAtFraction(chain, 0.5, 80)
    expect(position).not.toBeNull()
    expect(Math.abs(position!.bearing)).toBeGreaterThan(40)
    expect(position!.straightness).toBeGreaterThan(0.99)
  })

  it('uses the broad direction of a curved label-sized window instead of one local segment', () => {
    const chain = [[{ x: 40, y: 100 }, { x: 100, y: 60 }, { x: 160, y: 100 }]]
    const position = followRoadPositionAtFraction(chain, 0.5, 120)
    expect(position).not.toBeNull()
    expect(Math.abs(position!.bearing)).toBeLessThan(15)
    expect(position!.straightness).toBeLessThan(1)
  })

  it('keeps an eligible steep road label in the built anchor set', () => {
    const presentation = { fontSize: 20, haloWidth: 3, presentationScale: 1, measureTextWidth: () => 60 }
    const result = buildLineLabelAnchors(map as never, [line('steep', [[120, 180], [220, 20]], '急な街道')], presentation)
    expect(result.features.map((feature) => feature.properties.id)).toEqual(['steep'])
    expect(Math.abs(result.features[0].properties.bearing)).toBeGreaterThan(40)
    expect(result.features[0].properties.labelMode).toBe('follow-road')
  })
})

describe('app-owned line label overlap resolution', () => {
  const presentation = { fontSize: 20, haloWidth: 3, presentationScale: 1, measureTextWidth: () => 40 }

  it('keeps the active label and moves a colliding retained label to an alternate candidate', () => {
    const active = line('active', [[30, 100], [430, 100]], 'active', { sceneLineState: 'active', activeLine: true })
    const retained = line('retained', [[30, 100], [430, 100]], 'retained', { sceneLineState: 'retained' })
    const result = buildLineLabelAnchors(map as never, [retained, active], presentation).features
    expect(result.map((feature) => feature.properties.id)).toEqual(['active', 'retained'])
    expect(result[1].geometry.coordinates).not.toEqual(result[0].geometry.coordinates)
  })

  it('suppresses a retained label when all candidates collide with the active label', () => {
    const active = line('active', [[100, 100], [200, 100]], 'active', { sceneLineState: 'active', activeLine: true })
    const retained = line('retained', [[100, 100], [200, 100]], 'retained', { sceneLineState: 'retained' })
    expect(buildLineLabelAnchors(map as never, [retained, active], presentation).features.map((feature) => feature.properties.id)).toEqual(['active'])
  })

  it('gives Multi-mode selected labels equal stable priority and emits at most one per id', () => {
    const selectedA = line('A', [[30, 80], [430, 80]], 'A', { sceneLineState: 'selected' })
    const selectedB = line('B', [[30, 80], [430, 80]], 'B', { sceneLineState: 'selected' })
    const result = buildLineLabelAnchors(map as never, [selectedA, selectedA, selectedB], presentation).features
    expect(result[0].properties.id).toBe('A')
    expect(new Set(result.map((feature) => feature.properties.id)).size).toBe(result.length)
  })

  it('keeps every accepted candidate in the top 65 percent safe region', () => {
    const result = buildLineLabelAnchors(map as never, [line('A', [[20, 180], [480, 220]])], presentation).features
    expect(result.every((feature) => feature.geometry.coordinates[1] <= 300 * LABEL_SAFE_HEIGHT_RATIO)).toBe(true)
  })
})
