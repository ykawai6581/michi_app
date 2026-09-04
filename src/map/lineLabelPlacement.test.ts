import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import {
  buildLineLabelAnchors, LABEL_SAFE_HEIGHT_RATIO, MAX_STITCH_GAP_PX,
  pointAtPolylineMidpoint, requiredLabelLength, stitchVisibleFragments,
  uprightBearing, visualChainLength,
} from './lineLabelPlacement'

const map = {
  getCanvas: () => ({ width: 500, height: 300, clientWidth: 500, clientHeight: 300 }),
  project: ([x, y]: [number, number]) => ({ x, y }),
  unproject: ([x, y]: [number, number]) => ({ toArray: () => [x, y] }),
}
const presentation = { fontSize: 20, haloWidth: 3, presentationScale: 1, measureTextWidth: () => 100 }

function line(id: string, coordinates: number[][], name = '甲州街道', properties = {}): EntityFeature {
  return { type: 'Feature', properties: { id, name, type: 'road', ...properties }, geometry: { type: 'LineString', coordinates } } as EntityFeature
}
function anchors(features: EntityFeature[], shown = presentation) {
  return buildLineLabelAnchors(map as never, features, shown).features
}

describe('screen-space line label fit and visual continuity', () => {
  it('labels one sufficiently long fragment and suppresses one just below the additive requirement', () => {
    expect(requiredLabelLength('road', presentation)).toBe(130)
    expect(anchors([line('fits', [[30, 50], [160, 50]])])).toHaveLength(1)
    expect(anchors([line('short', [[30, 50], [159, 50]])])).toHaveLength(0)
  })

  it('regresses 荒玉水道道路 by stitching several individually short same-id pieces', () => {
    const pieces = [line('aratama', [[30, 60], [95, 60]], '荒玉水道道路'), line('aratama', [[100, 60], [165, 60]], '荒玉水道道路'), line('aratama', [[170, 60], [235, 60]], '荒玉水道道路')]
    expect([65, 65, 65].every((length) => length < 130)).toBe(true)
    expect(anchors(pieces)).toHaveLength(1)
  })

  it('never stitches same-name fragments across logical ids', () => {
    expect(anchors([line('A', [[30, 50], [95, 50]]), line('B', [[100, 50], [165, 50]])])).toHaveLength(0)
  })

  it('does not stitch a gap larger than the scaled threshold', () => {
    expect(anchors([line('A', [[30, 50], [95, 50]]), line('A', [[95 + MAX_STITCH_GAP_PX + 1, 50], [173, 50]])])).toHaveLength(0)
  })

  it('rejects a close join with excessive direction discontinuity', () => {
    expect(anchors([line('A', [[30, 50], [100, 50]]), line('A', [[105, 50], [105, 120]])])).toHaveLength(0)
  })

  it('stitches reversed source ordering', () => {
    expect(anchors([line('A', [[30, 50], [100, 50]]), line('A', [[175, 50], [105, 50]])])).toHaveLength(1)
  })

  it('stitches compatible MultiLineString components into one candidate', () => {
    const feature = { ...line('A', []), geometry: { type: 'MultiLineString', coordinates: [[[30, 50], [95, 50]], [[100, 50], [165, 50]]] } } as EntityFeature
    expect(anchors([feature])).toHaveLength(1)
  })

  it('clips before stitching and cannot connect upper pieces through the caption zone', () => {
    const feature = { ...line('A', []), geometry: { type: 'MultiLineString', coordinates: [[[30, 100], [90, 100]], [[90, 100], [90, 240], [110, 240], [110, 100]], [[110, 100], [170, 100]]] } } as EntityFeature
    expect(anchors([feature])).toHaveLength(0)
  })

  it('scales padding, halo, and stitch gap with presentation scale', () => {
    const scaled = { ...presentation, haloWidth: 6, presentationScale: 2, measureTextWidth: () => 200 }
    expect(requiredLabelLength('road', scaled)).toBe(260)
    expect(stitchVisibleFragments([[{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 20 + MAX_STITCH_GAP_PX * 2, y: 0 }, { x: 50, y: 0 }]], MAX_STITCH_GAP_PX * 2)).toHaveLength(1)
  })

  it('places the anchor at the cumulative midpoint of real fragment lengths without counting gaps', () => {
    const result = anchors([line('A', [[30, 50], [110, 50]]), line('A', [[120, 50], [180, 50]])], { ...presentation, measureTextWidth: () => 20 })
    expect(result[0].geometry.coordinates).toEqual([100, 50])
  })

  it('creates at most one anchor per logical id while preserving properties', () => {
    const result = anchors([line('A', [[30, 50], [200, 50]], '中央線', { type: 'railway', railColor: '#123456' }), line('A', [[30, 100], [200, 100]], '中央線', { type: 'railway', railColor: '#123456' })])
    expect(result).toHaveLength(1)
    expect(result[0].properties).toMatchObject({ id: 'A', type: 'railway', railColor: '#123456' })
  })

  it('omits offscreen geometry and geometry entirely below the safe region', () => {
    expect(anchors([line('offscreen', [[-200, -20], [-100, -20]])])).toEqual([])
    expect(anchors([line('caption', [[20, 220], [480, 220]])])).toEqual([])
  })

  it('clips a safe-boundary crossing and retains existing orientation helpers', () => {
    const result = anchors([line('crossing', [[250, 20], [250, 260]])], { ...presentation, measureTextWidth: () => 20 })
    expect(result[0].geometry.coordinates[1]).toBeLessThanOrEqual(300 * LABEL_SAFE_HEIGHT_RATIO)
    expect(pointAtPolylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 110, y: 0 }])?.point).toEqual({ x: 55, y: 0 })
    expect(uprightBearing({ x: 100, y: 20 }, { x: 0, y: 0 })).toBeCloseTo(11.31, 2)
  })

  it('does not include stitch gaps in visual chain length', () => {
    expect(visualChainLength([[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 20, y: 0 }, { x: 30, y: 0 }]])).toBe(20)
  })
})
