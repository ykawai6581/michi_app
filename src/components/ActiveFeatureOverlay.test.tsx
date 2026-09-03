import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EntityFeature, MapEntityType } from '../types/geo'
import { DEFAULT_HIGHLIGHT_STYLE } from '../map/highlightDefaults'
import { ActiveFeatureOverlay } from './ActiveFeatureOverlay'
import { formatEntityTypeLabel } from './entityTypeLabel'

const feature = (type: MapEntityType, name = '対象'): EntityFeature => ({
  type: 'Feature', properties: { id: `${type}-1`, name, type },
  geometry: { type: 'Point', coordinates: [139, 35] },
})

describe('ActiveFeatureOverlay', () => {
  it('renders the road caption with the shared road label color and halo', () => {
    const markup = renderToStaticMarkup(<ActiveFeatureOverlay feature={feature('road', '青梅道')} highlightStyle={DEFAULT_HIGHLIGHT_STYLE} />)
    expect(markup).toContain('青梅道')
    expect(markup).toContain('（現代道路）')
    expect(markup).toContain('--feature-label-color:#FF7B00')
    expect(markup).toContain('--road-label-halo-color:#FFFFFF')
    expect(markup).toContain('--road-label-halo-width:3px')
  })
  it.each(['jurisdiction', 'place', 'historical-place', 'station', 'railway'] as const)('does not render a large caption for %s', (type) => {
    expect(renderToStaticMarkup(<ActiveFeatureOverlay feature={feature(type)} highlightStyle={DEFAULT_HIGHLIGHT_STYLE} />)).toBe('')
  })
  it('renders a historical road caption', () => {
    expect(renderToStaticMarkup(<ActiveFeatureOverlay feature={feature('historical-road')} highlightStyle={DEFAULT_HIGHLIGHT_STYLE} />)).toContain('（江戸街道）')
  })
  it.each([
    ['road', '現代道路'], ['historical-road', '江戸街道'], ['railway', '鉄道'],
    ['station', '駅'], ['historical-place', '宿場'],
  ] as const)('maps %s to %s', (type, label) => {
    expect(formatEntityTypeLabel(feature(type))).toBe(label)
  })
})
