import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { initialLayerVisibility, initialPointOverlayStyle } from '../map/overlayState'
import { LayerPanel } from './LayerPanel'

describe('LayerPanel', () => {
  it('does not expose road source geometry controls', () => {
    const markup = renderToStaticMarkup(<LayerPanel value={initialLayerVisibility()} onChange={vi.fn()} pointStyle={initialPointOverlayStyle()} onPointStyleChange={vi.fn()} />)
    expect(markup).not.toContain('ROAD GEOMETRY')
    expect(markup).not.toContain('道路形状')
    expect(markup).not.toContain('N13 道路')
    expect(markup).not.toContain('OSM 道路')
  })
})
