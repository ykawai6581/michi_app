import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { initialLayerVisibility, initialPointOverlayStyle } from '../map/overlayState'
import { LayerPanel } from './LayerPanel'

describe('LayerPanel', () => {
  const renderPanel = (darkModeBehavior: 'auto' | 'manual') => renderToStaticMarkup(
    <LayerPanel value={initialLayerVisibility()} onChange={vi.fn()} darkModeBehavior={darkModeBehavior} onDarkModeBehaviorChange={vi.fn()} pointStyle={initialPointOverlayStyle()} onPointStyleChange={vi.fn()} />,
  )

  it('does not expose road source geometry controls', () => {
    const markup = renderPanel('auto')
    expect(markup).not.toContain('ROAD GEOMETRY')
    expect(markup).not.toContain('道路形状')
    expect(markup).not.toContain('N13 道路')
    expect(markup).not.toContain('OSM 道路')
  })

  it('disables the manual overlay in Auto mode', () => {
    const markup = renderPanel('auto')
    expect(markup).toContain('aria-label="Dark overlay" type="checkbox" disabled=""')
    expect(markup).toContain('選択中のオブジェクトに合わせて自動')
  })

  it('enables the manual overlay in Manual mode', () => {
    const markup = renderPanel('manual')
    expect(markup).toContain('aria-label="Dark overlay" type="checkbox"')
    expect(markup).not.toContain('aria-label="Dark overlay" type="checkbox" disabled=""')
    expect(markup).toContain('手動で背景を暗く表示')
  })

  it('keeps only Show all controls for station and shukuba icons', () => {
    const markup = renderPanel('auto')
    expect(markup).toContain('Show all')
    expect(markup).not.toContain('Icon size')
    expect(markup).not.toContain('icon size')
    expect(markup).not.toContain('type="range"')
    expect(markup).not.toContain('type="color"')
  })
})
