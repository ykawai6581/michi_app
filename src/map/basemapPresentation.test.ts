import { describe, expect, it, vi } from 'vitest'
import { applyBasemapAlpha, captureBasemapLayerGroup, waitForBasemapSources } from './basemapPresentation'

const layers = [
  { id: 'background', type: 'background', paint: {} },
  { id: 'fill', type: 'fill', paint: { 'fill-opacity': 0.4 } },
  { id: 'line', type: 'line', paint: { 'line-opacity': 0.6 } },
  { id: 'symbol', type: 'symbol', source: 'base', paint: { 'text-opacity': 0.8, 'icon-opacity': ['get', 'opacity'] } },
  { id: 'raster', type: 'raster', source: 'tiles', paint: { 'raster-opacity': 0.72 } },
  { id: 'michi-station', type: 'symbol', source: 'project' },
]

describe('basemap presentation', () => {
  it('multiplies authored geometry and symbol opacity without touching non-owned MICHI layers', () => {
    const changes: unknown[][] = []
    const map = { getStyle: () => ({ layers }), getLayer: (id: string) => layers.find(layer => layer.id === id), setLayoutProperty: vi.fn(), setPaintProperty: (...args: unknown[]) => changes.push(args) }
    const group = captureBasemapLayerGroup(map as never, 'presentation', ['background', 'fill', 'line', 'symbol', 'raster'])
    applyBasemapAlpha(map as never, group, 0.5, 0.25)
    expect(changes).toContainEqual(['background', 'background-opacity', 0.5])
    expect(changes).toContainEqual(['fill', 'fill-opacity', 0.2])
    expect(changes).toContainEqual(['line', 'line-opacity', 0.3])
    expect(changes).toContainEqual(['symbol', 'text-opacity', 0.1])
    expect(changes).toContainEqual(['symbol', 'icon-opacity', ['*', ['get', 'opacity'], 0.125]])
    expect(changes).toContainEqual(['raster', 'raster-opacity', 0.36])
    expect(changes.some(change => change[0] === 'michi-station')).toBe(false)
  })

  it('settles readiness at a bounded timeout instead of waiting forever', async () => {
    vi.useFakeTimers()
    const map = { getStyle: () => ({ layers }), isSourceLoaded: vi.fn(() => false), on: vi.fn(), off: vi.fn(), triggerRepaint: vi.fn() }
    const group = captureBasemapLayerGroup(map as never, 'gsi', ['raster'])
    const result = waitForBasemapSources(map as never, group, 25)
    await vi.advanceTimersByTimeAsync(25)
    await expect(result).resolves.toBe(false)
    vi.useRealTimers()
  })
})
