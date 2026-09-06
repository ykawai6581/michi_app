import type maplibregl from 'maplibre-gl'
import type { BasemapMode } from '../types/geo'

export const BASEMAP_RESOURCE_TIMEOUT_MS = 8_000

type OpacityProperty = 'background-opacity' | 'fill-opacity' | 'line-opacity' | 'text-opacity' | 'icon-opacity' | 'raster-opacity' | 'circle-opacity' | 'fill-extrusion-opacity'
type StyleLayer = maplibregl.LayerSpecification & { paint?: Record<string, unknown>; source?: string }
type Expression = unknown[]

const opacityProperties = (type: StyleLayer['type']): OpacityProperty[] => {
  switch (type) {
    case 'background': return ['background-opacity']
    case 'fill': return ['fill-opacity']
    case 'line': return ['line-opacity']
    case 'symbol': return ['text-opacity', 'icon-opacity']
    case 'raster': return ['raster-opacity']
    case 'circle': return ['circle-opacity']
    case 'fill-extrusion': return ['fill-extrusion-opacity']
    default: return []
  }
}

const isZoomInput = (value: unknown): value is ['zoom'] => Array.isArray(value) && value.length === 1 && value[0] === 'zoom'

const scaleOutput = (value: unknown, multiplier: number): unknown => {
  if (typeof value === 'number') return value * multiplier
  if (multiplier === 1) return value
  if (multiplier === 0) return 0
  return ['*', value, multiplier]
}

/**
 * Scale a MapLibre opacity value without nesting a zoom expression below `*`.
 * MapLibre requires `zoom` to remain the direct input of a top-level `step` or
 * `interpolate`, so zoom-dependent opacity expressions are rebuilt with their
 * output values scaled instead of wrapping the complete expression.
 */
export const scaleOpacityValue = (original: unknown, multiplier: number): unknown => {
  const value = original === undefined ? 1 : original
  if (typeof value === 'number') return value * multiplier
  if (!Array.isArray(value)) return scaleOutput(value, multiplier)

  const expression = value as Expression
  if (expression[0] === 'interpolate' && isZoomInput(expression[2])) {
    const scaled: Expression = [expression[0], expression[1], expression[2]]
    for (let index = 3; index < expression.length; index += 2) {
      scaled.push(expression[index], scaleOutput(expression[index + 1], multiplier))
    }
    return scaled
  }

  if (expression[0] === 'step' && isZoomInput(expression[1])) {
    const scaled: Expression = [expression[0], expression[1], scaleOutput(expression[2], multiplier)]
    for (let index = 3; index < expression.length; index += 2) {
      scaled.push(expression[index], scaleOutput(expression[index + 1], multiplier))
    }
    return scaled
  }

  return scaleOutput(value, multiplier)
}

export interface BasemapLayerGroup {
  mode: BasemapMode
  layerIds: string[]
  sourceIds: string[]
  layers: Map<string, { type: StyleLayer['type']; opacity: Partial<Record<OpacityProperty, unknown>> }>
}

/** Captures authored opacity values once, before presentation multipliers are applied. */
export function captureBasemapLayerGroup(map: maplibregl.Map, mode: BasemapMode, layerIds: string[]): BasemapLayerGroup {
  const styleLayers = map.getStyle().layers as StyleLayer[]
  const requested = new Set(layerIds)
  const layers = new Map<string, { type: StyleLayer['type']; opacity: Partial<Record<OpacityProperty, unknown>> }>()
  const sourceIds = new Set<string>()
  styleLayers.forEach(layer => {
    if (!requested.has(layer.id)) return
    const opacity: Partial<Record<OpacityProperty, unknown>> = {}
    opacityProperties(layer.type).forEach(property => { opacity[property] = layer.paint?.[property] })
    layers.set(layer.id, { type: layer.type, opacity })
    if (typeof layer.source === 'string') sourceIds.add(layer.source)
  })
  return { mode, layerIds: [...layers.keys()], sourceIds: [...sourceIds], layers }
}

/** Applies transition alpha to geometry and an additional label alpha to vector symbols. */
export function applyBasemapAlpha(map: maplibregl.Map, group: BasemapLayerGroup, alpha: number, labelAlpha: number, visibleAtZero = false): void {
  const baseAlpha = Math.max(0, Math.min(1, alpha))
  const labels = Math.max(0, Math.min(1, labelAlpha))
  group.layers.forEach((layer, id) => {
    if (!map.getLayer(id)) return
    map.setLayoutProperty(id, 'visibility', baseAlpha > 0 || visibleAtZero ? 'visible' : 'none')
    opacityProperties(layer.type).forEach(property => {
      const multiplier = baseAlpha * (layer.type === 'symbol' ? labels : 1)
      map.setPaintProperty(id, property, scaleOpacityValue(layer.opacity[property], multiplier) as never)
    })
  })
}

/** Waits only for sources owned by one basemap and always settles by the deadline. */
export function waitForBasemapSources(map: maplibregl.Map, group: BasemapLayerGroup, timeoutMs = BASEMAP_RESOURCE_TIMEOUT_MS): Promise<boolean> {
  if (!group.sourceIds.length || group.sourceIds.every(id => map.isSourceLoaded(id))) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = (ready: boolean) => { clearTimeout(timer); map.off('sourcedata', check); map.off('render', check); resolve(ready) }
    const check = () => { if (group.sourceIds.every(id => map.isSourceLoaded(id))) finish(true) }
    const timer = setTimeout(() => finish(false), timeoutMs)
    map.on('sourcedata', check); map.on('render', check); map.triggerRepaint()
  })
}
