import bbox from '@turf/bbox'
import type maplibregl from 'maplibre-gl'
import type { EntityFeature, HighlightStyle } from '../types/geo'
import { ROAD_LABEL_HALO_WIDTH } from './highlightDefaults'
import { pointIconSize } from './pointIcons'
import { annotationTextSize, type SceneSize } from './presentationScale'

export interface SceneFitPadding { top: number; right: number; bottom: number; left: number }
export type TextWidthMeasure = (text: string, fontSize: number) => number

let measurementContext: CanvasRenderingContext2D | null | undefined
export const measureSceneLabel = (text: string, fontSize: number): number => {
  if (measurementContext === undefined && typeof document !== 'undefined') measurementContext = document.createElement('canvas').getContext('2d')
  if (!measurementContext) return text.length * fontSize * 0.6
  measurementContext.font = `${fontSize}px "Noto Sans"`
  return measurementContext.measureText(text).width
}

export function sceneBounds(features: EntityFeature[]): [[number, number], [number, number]] | null {
  if (!features.length) return null
  const bounds = bbox({ type: 'FeatureCollection', features })
  return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]]
}

export function sceneFitPadding(features: EntityFeature[], style: HighlightStyle, presentationScale: number, sceneSize: SceneSize, measureText: TextWidthMeasure = measureSceneLabel): SceneFitPadding {
  const fontSize = annotationTextSize(style.annotationSize, presentationScale)
  const halo = ROAD_LABEL_HALO_WIDTH * presentationScale
  const safety = 12 * presentationScale
  const base = 28 * presentationScale
  const padding: SceneFitPadding = { top: base, right: base, bottom: base, left: base }

  for (const feature of features) {
    const labelWidth = measureText(feature.properties.name ?? '', fontSize)
    if (feature.geometry.type === 'Point') {
      if (feature.properties.type === 'station' || feature.properties.postId !== undefined) {
        const iconHalf = pointIconSize() * presentationScale / 2
        const gap = fontSize * 0.35
        padding.left = Math.max(padding.left, iconHalf + safety)
        padding.right = Math.max(padding.right, iconHalf + gap + labelWidth + halo + safety)
        padding.top = Math.max(padding.top, iconHalf + halo + safety)
        padding.bottom = Math.max(padding.bottom, iconHalf + halo + safety)
      } else {
        // Generic point annotations are centered below their marker.
        padding.left = Math.max(padding.left, labelWidth / 2 + halo + safety)
        padding.right = Math.max(padding.right, labelWidth / 2 + halo + safety)
        padding.top = Math.max(padding.top, 13 * presentationScale + safety)
        padding.bottom = Math.max(padding.bottom, 13 * presentationScale + fontSize * 1.5 + halo + safety)
      }
    } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
      const rotatedExtent = labelWidth / 2 + halo + safety
      padding.left = Math.max(padding.left, rotatedExtent)
      padding.right = Math.max(padding.right, rotatedExtent)
      padding.top = Math.max(padding.top, Math.min(rotatedExtent, fontSize * 2 + safety))
      padding.bottom = Math.max(padding.bottom, Math.min(rotatedExtent, fontSize * 2 + safety))
    } else {
      padding.left = Math.max(padding.left, labelWidth / 2 + halo + safety)
      padding.right = Math.max(padding.right, labelWidth / 2 + halo + safety)
      padding.top = Math.max(padding.top, fontSize + halo + safety)
      padding.bottom = Math.max(padding.bottom, fontSize + halo + safety)
    }
  }

  // Keep a usable geographic viewport even for exceptionally long annotations.
  padding.left = Math.min(padding.left, sceneSize.width * 0.42)
  padding.right = Math.min(padding.right, sceneSize.width * 0.42)
  padding.top = Math.min(padding.top, sceneSize.height * 0.42)
  padding.bottom = Math.min(padding.bottom, sceneSize.height * 0.42)
  return padding
}

export function fitVisibleScene(map: maplibregl.Map, features: EntityFeature[], style: HighlightStyle, presentationScale: number, sceneSize: SceneSize, duration = 900): void {
  const bounds = sceneBounds(features)
  if (!bounds) return
  map.fitBounds(bounds, { padding: sceneFitPadding(features, style, presentationScale, sceneSize), maxZoom: 15, duration })
}
