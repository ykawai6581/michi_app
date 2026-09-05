import { describe, expect, it } from 'vitest'
import { calculatePresentationScale, SCENE_REFERENCE_WIDTH } from './presentationScale'
import { mapRenderPixelRatio } from './renderPixelRatio'

const referenceScene = { logicalWidth: 960, logicalHeight: 540 }
const ratio = (displayedWidth: number, displayedHeight: number, devicePixelRatio: number, maxCanvasSize = 4096) => mapRenderPixelRatio({ ...referenceScene, displayedWidth, displayedHeight, devicePixelRatio, maxCanvasSize })

describe('MapLibre render pixel ratio', () => {
  it('uses one physical pixel at DPR 1 without enlargement', () => {
    expect(ratio(960, 540, 1)).toEqual({ visualScale: 1, desiredPixelRatio: 1, effectivePixelRatio: 1 })
  })
  it('accounts for Retina density without changing the logical scene', () => {
    expect(ratio(960, 540, 2).effectivePixelRatio).toBe(2)
    expect(referenceScene).toEqual({ logicalWidth: 960, logicalHeight: 540 })
  })
  it('accounts for CSS enlargement', () => expect(ratio(1920, 1080, 1).effectivePixelRatio).toBe(2))
  it('combines Retina density and CSS enlargement', () => expect(ratio(1920, 1080, 2).effectivePixelRatio).toBe(4))
  it('clamps each backing-canvas dimension to the configured limit', () => {
    const result = ratio(3840, 2160, 2)
    expect(result.desiredPixelRatio).toBe(8)
    expect(result.effectivePixelRatio).toBeCloseTo(4096 / 960)
    expect(referenceScene.logicalWidth * result.effectivePixelRatio).toBeCloseTo(4096)
    expect(referenceScene.logicalHeight * result.effectivePixelRatio).toBeLessThanOrEqual(4096)
  })
  it('uses the limiting axis for an aspect-ratio-preserving fit', () => expect(ratio(1920, 900, 1).visualScale).toBeCloseTo(900 / 540))
  it('raises render density on resize without changing logical dimensions', () => {
    expect(ratio(1920, 1080, 1).effectivePixelRatio).toBeGreaterThan(ratio(960, 540, 1).effectivePixelRatio)
    expect(referenceScene).toEqual({ logicalWidth: 960, logicalHeight: 540 })
  })
  it('keeps semantic presentation scale independent from render density', () => {
    expect(calculatePresentationScale(SCENE_REFERENCE_WIDTH)).toBe(1)
    expect(ratio(1920, 1080, 2).effectivePixelRatio).toBe(4)
    expect(calculatePresentationScale(SCENE_REFERENCE_WIDTH)).toBe(1)
  })
})
