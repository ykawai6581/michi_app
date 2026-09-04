import { describe, expect, it, vi } from 'vitest'
import { ROAD_LABEL_HALO_WIDTH } from './highlightDefaults'
import { annotationTextSize, calculatePresentationScale } from './presentationScale'

describe('map-canvas presentation scale', () => {
  it.each([[980, 1], [1435, 1435 / 980], [490, 0.5]])('calculates width %d as scale %f', (width, expected) => {
    expect(calculatePresentationScale(width)).toBeCloseTo(expected)
  })

  it('depends only on the supplied canvas width', () => {
    vi.stubGlobal('window', { innerWidth: 4000 })
    expect(calculatePresentationScale(980)).toBe(1)
    vi.stubGlobal('window', { innerWidth: 500 })
    expect(calculatePresentationScale(980)).toBe(1)
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
