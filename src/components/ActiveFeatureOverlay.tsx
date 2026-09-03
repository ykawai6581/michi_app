import type { CSSProperties } from 'react'
import type { EntityFeature, HighlightStyle } from '../types/geo'
import { featureHighlightColor } from '../map/highlight'
import { formatEntityTypeLabel } from './entityTypeLabel'

export function ActiveFeatureOverlay({ feature, highlightStyle }: { feature: EntityFeature | null; highlightStyle: HighlightStyle }) {
  if (!feature) return null
  const captionStyle = { '--feature-label-color': featureHighlightColor(feature, highlightStyle) } as CSSProperties
  return <div className="map-title" key={feature.properties.id} aria-live="polite" style={captionStyle}>
    <h1>{feature.properties.name}<span>（{formatEntityTypeLabel(feature)}）</span></h1>
  </div>
}
