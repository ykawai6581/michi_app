import bbox from '@turf/bbox'
import type { Position } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { EntityFeature, HighlightStyle } from '../types/geo'
import { LAYER_IDS, SOURCE_IDS } from './config'

const activeAnimations = new WeakMap<maplibregl.Map, number>()

function interpolate(from: Position, to: Position, amount: number): Position {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount]
}

function linePrefix(coordinates: Position[], progress: number): Position[] {
  if (coordinates.length < 2 || progress >= 1) return coordinates
  const lengths = coordinates.slice(1).map((point, index) => Math.hypot(point[0] - coordinates[index][0], point[1] - coordinates[index][1]))
  const target = lengths.reduce((sum, length) => sum + length, 0) * progress
  const result: Position[] = [coordinates[0]]
  let travelled = 0
  for (let index = 0; index < lengths.length; index += 1) {
    if (travelled + lengths[index] >= target) {
      const amount = lengths[index] === 0 ? 0 : (target - travelled) / lengths[index]
      result.push(interpolate(coordinates[index], coordinates[index + 1], amount))
      break
    }
    result.push(coordinates[index + 1])
    travelled += lengths[index]
  }
  return result
}

function clipRingAtLongitude(ring: Position[], limit: number): Position[] {
  const output: Position[] = []
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const previous = ring[(index + ring.length - 1) % ring.length]
    const currentInside = current[0] <= limit
    const previousInside = previous[0] <= limit
    if (currentInside !== previousInside) {
      const amount = (limit - previous[0]) / (current[0] - previous[0])
      output.push(interpolate(previous, current, amount))
    }
    if (currentInside) output.push(current)
  }
  if (output.length > 0) output.push([...output[0]])
  return output
}

function partialFeature(feature: EntityFeature, progress: number): EntityFeature {
  if (feature.geometry.type === 'LineString') {
    return { ...feature, geometry: { ...feature.geometry, coordinates: linePrefix(feature.geometry.coordinates, progress) } }
  }
  if (feature.geometry.type === 'Polygon') {
    const bounds = bbox(feature)
    const limit = bounds[0] + (bounds[2] - bounds[0]) * progress
    const rings = feature.geometry.coordinates.map((ring) => clipRingAtLongitude(ring, limit)).filter((ring) => ring.length >= 4)
    if (rings.length > 0) return { ...feature, geometry: { ...feature.geometry, coordinates: rings } }
  }
  return feature
}

function revealFeature(map: maplibregl.Map, feature: EntityFeature): void {
  const previous = activeAnimations.get(map)
  if (previous !== undefined) cancelAnimationFrame(previous)
  const source = map.getSource(SOURCE_IDS.highlight) as GeoJSONSource
  const started = performance.now()
  const duration = 1250
  const frame = (now: number) => {
    const linearProgress = Math.min((now - started) / duration, 1)
    const easedProgress = 1 - Math.pow(1 - linearProgress, 3)
    source.setData(partialFeature(feature, Math.max(easedProgress, 0.002)))
    if (linearProgress < 1) activeAnimations.set(map, requestAnimationFrame(frame))
    else activeAnimations.delete(map)
  }
  activeAnimations.set(map, requestAnimationFrame(frame))
}

export function selectFeature(map: maplibregl.Map, feature: EntityFeature, animate = false): void {
  const previous = activeAnimations.get(map)
  if (previous !== undefined) cancelAnimationFrame(previous)
  if (animate && (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon')) revealFeature(map, feature)
  else (map.getSource(SOURCE_IDS.highlight) as GeoJSONSource).setData(feature)
  if (feature.geometry.type === 'Point') map.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 15, duration: 900 })
  else { const bounds = bbox(feature); map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]], { padding: 100, maxZoom: 15, duration: 900 }) }
}

export function updateHighlightStyle(map: maplibregl.Map, style: HighlightStyle): void {
  for (const id of [LAYER_IDS.highlightLine, LAYER_IDS.highlightFill, LAYER_IDS.highlightPoint, LAYER_IDS.highlightPointGlow]) map.setPaintProperty(id, id.includes('line') ? 'line-color' : id.includes('fill') ? 'fill-color' : 'circle-color', style.color)
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-width', style.width)
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-opacity', style.opacity)
  map.setPaintProperty(LAYER_IDS.highlightLineGlow, 'line-width', style.width + 7)
  map.setPaintProperty(LAYER_IDS.highlightLineGlow, 'line-opacity', style.glow ? style.opacity * 0.65 : 0)
  map.setPaintProperty(LAYER_IDS.highlightFill, 'fill-opacity', style.opacity * 0.38)
  map.setPaintProperty(LAYER_IDS.highlightPoint, 'circle-opacity', style.opacity)
  map.setPaintProperty(LAYER_IDS.highlightPointGlow, 'circle-opacity', style.glow ? style.opacity * 0.24 : 0)
}
