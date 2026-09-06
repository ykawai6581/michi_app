import { describe, expect, it } from 'vitest'
import { CLOUD_HOLD_DURATION_MS, CLOUD_SLIDE_DURATION_MS, CLOUD_TRANSITION_DURATION_MS, CLOUD_VIEWBOX_HEIGHT, cloudBankPath, cloudCoverProgress, generateCloudBank } from './cloudTransition'

describe('geometric cloud transition', () => {
  it('slides in, holds fully covered for 0.5 seconds, then recedes', () => {
    const slideFraction = CLOUD_SLIDE_DURATION_MS / CLOUD_TRANSITION_DURATION_MS
    const holdEnd = 1 - slideFraction
    expect(CLOUD_HOLD_DURATION_MS).toBe(500)
    expect(cloudCoverProgress(0)).toBe(0)
    expect(cloudCoverProgress(slideFraction)).toBe(1)
    expect(cloudCoverProgress((slideFraction + holdEnd) / 2)).toBe(1)
    expect(cloudCoverProgress(holdEnd)).toBe(1)
    expect(cloudCoverProgress(1)).toBe(0)
    expect(cloudCoverProgress(slideFraction / 2)).toBeGreaterThan(0)
    expect(cloudCoverProgress((1 + holdEnd) / 2)).toBeGreaterThan(0)
  })

  it('regenerates identical but non-uniform geometry from a seed', () => {
    const first = generateCloudBank(12345)
    const second = generateCloudBank(12345)
    const other = generateCloudBank(54321)
    expect(second).toEqual(first)
    expect(other).not.toEqual(first)
    expect(new Set(first.edge.map(point => Math.round(point.x))).size).toBeGreaterThan(3)
    expect(first.edge.at(-1)?.y).toBe(CLOUD_VIEWBOX_HEIGHT)
  })

  it('creates a closed stepped bank path', () => {
    const path = cloudBankPath(generateCloudBank(7))
    expect(path.startsWith('M 0 0 H ')).toBe(true)
    expect(path).toContain(`V ${CLOUD_VIEWBOX_HEIGHT}`)
    expect(path.endsWith('Z')).toBe(true)
  })
})
