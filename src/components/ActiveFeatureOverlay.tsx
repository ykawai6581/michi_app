import type { CSSProperties } from 'react'
import type { EntityFeature, HighlightStyle } from '../types/geo'
import { ROAD_LABEL_HALO_COLOR, ROAD_LABEL_HALO_WIDTH } from '../map/highlightDefaults'
import { FALLBACK_RAIL_COLOR } from '../map/highlight'

export function ActiveFeatureOverlay({ feature, highlightStyle }: { feature: EntityFeature | null; highlightStyle: HighlightStyle }) {
  if (!feature || (feature.properties.type !== 'road' && feature.properties.type !== 'railway')) return null
  const captionStyle = {
    '--feature-label-color': feature.properties.type === 'railway' ? feature.properties.railColor ?? FALLBACK_RAIL_COLOR : highlightStyle.roadColor,
    '--road-label-halo-color': ROAD_LABEL_HALO_COLOR,
    '--road-label-halo-width': `${ROAD_LABEL_HALO_WIDTH}px`,
  } as CSSProperties
  return <div className="map-title" key={feature.properties.id} aria-live="polite" style={captionStyle}>
    <h1>{feature.properties.name}</h1>
  </div>
}
