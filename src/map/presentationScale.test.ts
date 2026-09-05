import { describe, expect, it, vi } from 'vitest'
import { ROAD_LABEL_HALO_WIDTH } from './highlightDefaults'
import { annotationTextSize, calculatePresentationScale, getEffectiveSceneSize, SCENE_ASPECT_RATIO, SCENE_REFERENCE_HEIGHT, SCENE_REFERENCE_WIDTH } from './presentationScale'

describe('map-canvas presentation scale', () => {
  it.each([[960, 1], [480, 0.5]])('calculates effective width %d as scale %f', (width, expected) => {
    expect(calculatePresentationScale(width)).toBeCloseTo(expected)
  })

  it('clamps a large viewport to the fixed reference frame', () => {
    expect(getEffectiveSceneSize(1920, 1080)).toEqual({ width: SCENE_REFERENCE_WIDTH, height: SCENE_REFERENCE_HEIGHT })
    expect(calculatePresentationScale(getEffectiveSceneSize(3840, 2160).width)).toBe(1)
  })

  it('shrinks to fit while preserving the 16:9 scene ratio', () => {
    const scene = getEffectiveSceneSize(800, 1000)
    expect(scene).toEqual({ width: 800, height: 450 })
    expect(scene.width / scene.height).toBe(SCENE_ASPECT_RATIO)
  })

  it('uses height as the limiting dimension without changing the aspect ratio', () => {
    expect(getEffectiveSceneSize(1000, 360)).toEqual({ width: 640, height: 360 })
  })

  it('depends only on the supplied effective scene width', () => {
    vi.stubGlobal('window', { innerWidth: 4000 })
    expect(calculatePresentationScale(960)).toBe(1)
    vi.stubGlobal('window', { innerWidth: 500 })
    expect(calculatePresentationScale(960)).toBe(1)
    vi.unstubAllGlobals()
  })

  it.each([
    ['large', 1, 28], ['large', 1.5, 42],
    ['normal', 1, 14], ['normal', 1.5, 21],
  ] as const)('applies scale after selecting the %s base size', (size, scale, expected) => {
    expect(annotationTextSize(size, scale)).toBe(expected)
  })

  it('scales the label halo from its base width', () => {
    expect(ROAD_LABEL_HALO_WIDTH * 1.5).toBe(4.5)
  })
})
