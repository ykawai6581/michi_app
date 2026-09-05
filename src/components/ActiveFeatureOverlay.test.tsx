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
    expect(markup).not.toContain('（現代道路）')
    expect(markup).toContain('--feature-label-color:#FF7B00')
    expect(markup).toContain('--road-label-halo-color:#FFFFFF')
    expect(markup).toContain('--road-label-halo-width:3px')
  })
  it.each(['jurisdiction', 'place', 'historical-place', 'station'] as const)('does not render a large caption for %s', (type) => {
    expect(renderToStaticMarkup(<ActiveFeatureOverlay feature={feature(type)} highlightStyle={DEFAULT_HIGHLIGHT_STYLE} />)).toBe('')
  })
  it('renders a historical-road caption in its distinct color', () => { const markup=renderToStaticMarkup(<ActiveFeatureOverlay feature={feature('historical-road','甲州道中')} highlightStyle={DEFAULT_HIGHLIGHT_STYLE}/>); expect(markup).toContain('甲州道中'); expect(markup).toContain('--feature-label-color:#5C3838') })
  it('renders a railway name only in its resolved color', () => {
    const railway={...feature('railway','JR 中央線快速'),properties:{...feature('railway').properties,name:'JR 中央線快速',railColor:'#FF4500'}}
    const markup=renderToStaticMarkup(<ActiveFeatureOverlay feature={railway} highlightStyle={DEFAULT_HIGHLIGHT_STYLE}/>)
    expect(markup).toContain('JR 中央線快速');expect(markup).toContain('--feature-label-color:#FF4500');expect(markup).not.toContain('（鉄道）')
  })
  it.each([
    ['road', '現代道路'], ['historical-road', '江戸街道'], ['railway', '鉄道'],
    ['station', '駅'], ['historical-place', '宿場'],
  ] as const)('maps %s to %s', (type, label) => {
    expect(formatEntityTypeLabel(feature(type))).toBe(label)
  })
})
