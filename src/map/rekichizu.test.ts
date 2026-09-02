import { afterEach, describe, expect, it, vi } from 'vitest'
import { addRekichizuBasemap, REKICHIZU_PREFIX } from './rekichizu'

afterEach(() => vi.unstubAllGlobals())

describe('Rekichizu basemap installation', () => {
  it('namespaces official sources, layers, and sprite references below project layers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 8,
        sources: { history: { type: 'vector', tiles: ['../../../rekichizu-data/tiles/v1/{z}/{x}/{y}.pbf'] } },
        layers: [
          { id: 'land', type: 'fill', source: 'history', 'source-layer': 'landcover', paint: { 'fill-pattern': 'grass' } },
          { id: 'places', type: 'symbol', source: 'history', 'source-layer': 'poi', layout: { 'icon-image': ['get', 'icon'] } },
        ],
      }),
    }))
    const sources: unknown[][] = []; const layers: unknown[][] = []
    const map = {
      getSource: () => undefined,
      addSource: (...args: unknown[]) => sources.push(args),
      getLayer: () => undefined,
      addLayer: (...args: unknown[]) => layers.push(args),
    }

    const ids = await addRekichizuBasemap(map as never, 'michi-white-base')

    expect(ids).toEqual([`${REKICHIZU_PREFIX}land`, `${REKICHIZU_PREFIX}places`])
    expect(sources[0][0]).toBe(`${REKICHIZU_PREFIX}history`)
    expect(sources[0][1]).toMatchObject({ tiles: ['https://mierune.github.io/rekichizu-data/tiles/v1/{z}/{x}/{y}.pbf'] })
    expect(layers[0]).toMatchObject([{ source: `${REKICHIZU_PREFIX}history`, layout: { visibility: 'none' }, paint: { 'fill-pattern': ['concat', REKICHIZU_PREFIX, 'grass'] } }, 'michi-white-base'])
    expect(layers[1]).toMatchObject([{ layout: { visibility: 'none', 'icon-image': ['concat', REKICHIZU_PREFIX, ['get', 'icon']] } }, 'michi-white-base'])
  })

  it('does not add duplicate source or layer IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: { history: { type: 'vector', tiles: [] } }, layers: [{ id: 'road', type: 'line', source: 'history' }] }) }))
    const map = { getSource: () => ({}), addSource: vi.fn(), getLayer: () => ({}), addLayer: vi.fn() }
    await addRekichizuBasemap(map as never, 'overlay')
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })
})
