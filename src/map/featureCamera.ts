import bbox from '@turf/bbox'
import type maplibregl from 'maplibre-gl'
import type { EntityFeature, HighlightStyle } from '../types/geo'
import type { CameraView } from '../story/storyTypes'
import type { SceneSize } from './presentationScale'
import { sceneBounds, sceneFitPadding, shouldFitVisibleScene } from './sceneFit'

const viewFromOptions = (fallback: CameraView, options: maplibregl.CameraOptions | undefined): CameraView => {
  if (!options) return fallback
  const center = options.center
  const coordinates: [number, number] = Array.isArray(center) ? [center[0], center[1]] : center ? ['lng' in center ? center.lng : center.lon, center.lat] : fallback.center
  return { center: coordinates, zoom: options.zoom ?? fallback.zoom, bearing: options.bearing ?? fallback.bearing, pitch: options.pitch ?? fallback.pitch }
}

/** Resolves the same feature-focus composition used by manual activation, without moving the map. */
export function resolveFeatureCameraTarget(map: maplibregl.Map, feature: EntityFeature, visible: EntityFeature[], from: CameraView, style: HighlightStyle, presentationScale: number, sceneSize: SceneSize): CameraView {
  if (feature.geometry.type === 'Point') return { ...from, center: [...feature.geometry.coordinates] as [number, number], zoom: 15 }
  const bounds = shouldFitVisibleScene(feature) ? sceneBounds(visible) : (() => { const value = bbox(feature); return [[value[0], value[1]], [value[2], value[3]]] as [[number, number], [number, number]] })()
  if (!bounds) return from
  const padding = shouldFitVisibleScene(feature) ? sceneFitPadding(visible, style, presentationScale, sceneSize) : 100
  return viewFromOptions(from, map.cameraForBounds(bounds, { padding, maxZoom: 15 }))
}
