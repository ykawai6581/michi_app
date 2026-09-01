import type { EntityFeature } from '../types/geo'
import { formatEntityTypeLabel } from './entityTypeLabel'

export function ActiveFeatureOverlay({ feature }: { feature: EntityFeature | null }) {
  if (!feature) return null
  return <div className="map-title" key={feature.properties.id} aria-live="polite">
    <h1>{feature.properties.name}<span>（{formatEntityTypeLabel(feature)}）</span></h1>
  </div>
}
