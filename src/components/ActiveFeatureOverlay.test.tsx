import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EntityFeature, MapEntityType } from '../types/geo'
import { ActiveFeatureOverlay } from './ActiveFeatureOverlay'
import { formatEntityTypeLabel } from './entityTypeLabel'

const highlightStyle = { roadColor: '#FF7B00', locationColor: '#64c2f2', regionColor: '#3264aa', width: 7, opacity: 1, glow: true, animate: true, annotationSize: 'large' } as const

const feature = (type: MapEntityType, name = '対象'): EntityFeature => ({
  type: 'Feature', properties: { id: `${type}-1`, name, type },
  geometry: { type: 'Point', coordinates: [139, 35] },
})

describe('ActiveFeatureOverlay', () => {
  it('renders nothing without an active feature', () => {
    expect(renderToStaticMarkup(<ActiveFeatureOverlay feature={null} highlightStyle={highlightStyle} />)).toBe('')
  })
  it('renders the feature name and Japanese type in parentheses', () => {
    const markup = renderToStaticMarkup(<ActiveFeatureOverlay feature={feature('historical-place', '新中野')} highlightStyle={highlightStyle} />)
    expect(markup).toContain('新中野')
    expect(markup).toContain('（宿場）')
  })
  it('uses the road label color for road captions', () => {
    const markup = renderToStaticMarkup(<ActiveFeatureOverlay feature={feature('road')} highlightStyle={highlightStyle} />)
    expect(markup).toContain('--feature-label-color:#FF7B00')
  })
  it.each([
    ['road', '現代道路'], ['historical-road', '江戸街道'], ['railway', '鉄道'],
    ['station', '駅'], ['historical-place', '宿場'],
  ] as const)('maps %s to %s', (type, label) => {
    expect(formatEntityTypeLabel(feature(type))).toBe(label)
  })
})
