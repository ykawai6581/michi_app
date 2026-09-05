import bbox from '@turf/bbox'
import type { FeatureCollection, Geometry, Position } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { EntityFeature, EntityProperties, HighlightStyle, RoadSourceVisibility, SelectionMode } from '../types/geo'
import { LAYER_IDS, SOURCE_IDS } from './config'
import railColors from '../../data/sources/railcolors.json'
import { ACTIVE_LINE_CASING_EXTRA_WIDTH, ACTIVE_LINE_SHADOW_EXTRA_WIDTH, ROAD_LABEL_HALO_WIDTH } from './highlightDefaults'
import { annotationTextSize } from './presentationScale'
import { clipFeaturesOutsideReveal, type RevealCircle } from './revealArea'
import { buildLineLabelAnchors, type LineLabelPresentation } from './lineLabelPlacement'

export const FALLBACK_RAIL_COLOR = railColors.fallbackColor
export const RETAINED_LINE_COLOR = '#7B8589'
export const selectedLineColorExpression = (roadColor: string, historicalRoadColor: string): maplibregl.ExpressionSpecification => ['case', ['==', ['get', 'type'], 'railway'], ['coalesce', ['get', 'railColor'], FALLBACK_RAIL_COLOR], ['==', ['get', 'type'], 'historical-road'], historicalRoadColor, roadColor]
export const sceneLineColorExpression = (roadColor: string, historicalRoadColor: string): maplibregl.ExpressionSpecification => ['case', ['==', ['get', 'sceneLineState'], 'retained'], RETAINED_LINE_COLOR, selectedLineColorExpression(roadColor, historicalRoadColor)]
export const lineColorExpression = selectedLineColorExpression

let lineLabelMeasurementContext: CanvasRenderingContext2D | null | undefined
function measureLineLabelText(label: string, fontSize: number): number {
  if (lineLabelMeasurementContext === undefined) lineLabelMeasurementContext = document.createElement('canvas').getContext('2d')
  if (!lineLabelMeasurementContext) return Number.POSITIVE_INFINITY
  lineLabelMeasurementContext.font = `${fontSize}px "Noto Sans"`
  return lineLabelMeasurementContext.measureText(label).width
}

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

function multiLinePrefix(lines: Position[][], progress: number): Position[][] {
  const lengths = lines.map((line) => line.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0))
  const target = lengths.reduce((sum, length) => sum + length, 0) * progress
  const result: Position[][] = []
  let travelled = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (travelled + lengths[index] >= target) {
      result.push(linePrefix(lines[index], lengths[index] === 0 ? 1 : (target - travelled) / lengths[index]))
      break
    }
    result.push(lines[index])
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
  if (feature.geometry.type === 'MultiLineString') {
    return { ...feature, geometry: { ...feature.geometry, coordinates: multiLinePrefix(feature.geometry.coordinates, progress) } }
  }
  if (feature.geometry.type === 'Polygon') {
    const bounds = bbox(feature)
    const limit = bounds[0] + (bounds[2] - bounds[0]) * progress
    const rings = feature.geometry.coordinates.map((ring) => clipRingAtLongitude(ring, limit)).filter((ring) => ring.length >= 4)
    if (rings.length > 0) return { ...feature, geometry: { ...feature.geometry, coordinates: rings } }
  }
  return feature
}

function collection(features: EntityFeature[]): FeatureCollection<Geometry, EntityProperties> {
  return { type: 'FeatureCollection', features }
}

export function updateSelectedPointFilters(map: maplibregl.Map, features: EntityFeature[]): void {
  const ids = features
    .filter((feature) => feature.geometry.type === 'Point' && (feature.properties.type === 'station' || feature.properties.postId !== undefined))
    .map((feature) => feature.properties.id)
  const filter: maplibregl.FilterSpecification = ids.length
    ? ['!', ['in', ['get','id'], ['literal',ids]]]
    : ['==', ['literal',true], true]
  map.setFilter(LAYER_IDS.stations, filter)
  map.setFilter(LAYER_IDS.historicalPosts, filter)
}

export function splitRoadSourceFeatures(features: EntityFeature[], roadSources: RoadSourceVisibility): { primary: EntityFeature[]; osm: EntityFeature[] } {
  return {
    primary: features.filter((feature) => feature.properties.type !== 'road' || roadSources.n13),
    osm: features.flatMap((feature): EntityFeature[] => feature.properties.type === 'road' && roadSources.osm && feature.properties.roadSourceGeometries
      ? [{ ...feature, geometry: feature.properties.roadSourceGeometries.osm }]
      : []),
  }
}

function visibleSceneLabelFeatures(primary: EntityFeature[], osm: EntityFeature[]): EntityFeature[] {
  const primaryIds = new Set(primary.map((feature) => feature.properties.id))
  return [...primary, ...osm.filter((feature) => !primaryIds.has(feature.properties.id))]
}

export function buildSceneLineLabelAnchors(map: Pick<maplibregl.Map, 'project' | 'unproject' | 'getCanvas'>, features: EntityFeature[], presentation: LineLabelPresentation) {
  const historicalRoadIds = new Set(features.filter((feature) => feature.properties.type === 'historical-road').map((feature) => feature.properties.id))
  const placementFeatures = features.map((feature) => feature.properties.type === 'historical-road'
    ? { ...feature, properties: { ...feature.properties, type: 'road' as const } }
    : feature)
  const anchors = buildLineLabelAnchors(map, placementFeatures, presentation)
  return {
    ...anchors,
    features: anchors.features.map((anchor) => historicalRoadIds.has(anchor.properties.id)
      ? { ...anchor, properties: { ...anchor.properties, type: 'historical-road' as const } }
      : anchor),
  }
}

function revealFeature(map: maplibregl.Map, features: EntityFeature[], feature: EntityFeature): void {
  const previous = activeAnimations.get(map)
  if (previous !== undefined) cancelAnimationFrame(previous)
  const source = map.getSource(SOURCE_IDS.highlight) as GeoJSONSource
  const started = performance.now()
  const duration = 1250
  const frame = (now: number) => {
    const linearProgress = Math.min((now - started) / duration, 1)
    const easedProgress = 1 - Math.pow(1 - linearProgress, 3)
    const frameFeatures = features.map((candidate) => candidate.properties.id === feature.properties.id ? partialFeature(candidate, Math.max(easedProgress, 0.002)) : candidate)
    source.setData(collection(frameFeatures))
    if (linearProgress < 1) activeAnimations.set(map, requestAnimationFrame(frame))
    else activeAnimations.delete(map)
  }
  activeAnimations.set(map, requestAnimationFrame(frame))
}

export function markActiveLine(features: EntityFeature[], activeFeature: EntityFeature | null, selectionMode: SelectionMode = 'multi'): EntityFeature[] {
  const activeType = activeFeature && ['road', 'historical-road', 'railway'].includes(activeFeature.properties.type) ? activeFeature.properties.type : null
  const activeId = activeType ? activeFeature?.properties.id : null
  return features.map((feature) => {
    const isLine = ['road', 'historical-road', 'railway'].includes(feature.properties.type)
    const activeLine = isLine && feature.properties.type === activeType && feature.properties.id === activeId
    return { ...feature, properties: { ...feature.properties, activeLine,
      ...(isLine ? { sceneLineState: selectionMode === 'multi' ? 'selected' : activeLine ? 'active' : 'retained' } : {}),
    } }
  })
}

export function selectFeatures(map: maplibregl.Map, features: EntityFeature[], roadSources: RoadSourceVisibility, activeFeature: EntityFeature | null, selectionMode: SelectionMode = 'multi', revealTarget?: EntityFeature, animate = false, revealCircle?:RevealCircle): void {
  const previous = activeAnimations.get(map)
  if (previous !== undefined) cancelAnimationFrame(previous)
  const rendered=clipFeaturesOutsideReveal(map,features,revealCircle)
  const { primary, osm } = splitRoadSourceFeatures(markActiveLine(rendered, activeFeature, selectionMode), roadSources)
  updateSelectedPointFilters(map, primary)
  const revealFocus = revealTarget && primary.find((feature) => feature.properties.id === revealTarget.properties.id)
  if (revealFocus && animate && (revealFocus.geometry.type === 'LineString' || revealFocus.geometry.type === 'MultiLineString' || revealFocus.geometry.type === 'Polygon')) revealFeature(map, primary, revealFocus)
  else (map.getSource(SOURCE_IDS.highlight) as GeoJSONSource).setData(collection(primary))
  ;(map.getSource(SOURCE_IDS.highlightOsm) as GeoJSONSource).setData(collection(osm))

  // Historical roads and railways use the scene-wide, label-aware fit in MapView.
  // Every other feature keeps the pre-sceneFit camera behavior.
  if (!revealTarget || revealTarget.properties.type === 'historical-road' || revealTarget.properties.type === 'railway') return
  if (revealTarget.geometry.type === 'Point') map.flyTo({ center: revealTarget.geometry.coordinates as [number, number], zoom: 15, duration: 900 })
  else { const bounds = bbox(revealTarget); map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]], { padding: 100, maxZoom: 15, duration: 900 }) }
}

export function updateLineLabelAnchors(map: maplibregl.Map, features: EntityFeature[], roadSources: RoadSourceVisibility, activeFeature: EntityFeature | null, selectionMode: SelectionMode, style: HighlightStyle, presentationScale: number, revealCircle?:RevealCircle): void {
  const rendered=clipFeaturesOutsideReveal(map,features,revealCircle)
  const { primary, osm } = splitRoadSourceFeatures(markActiveLine(rendered, activeFeature, selectionMode), roadSources)
  ;(map.getSource(SOURCE_IDS.highlightLineLabels) as GeoJSONSource).setData(buildSceneLineLabelAnchors(map, visibleSceneLabelFeatures(primary, osm), { fontSize: annotationTextSize(style.annotationSize, presentationScale), haloWidth: ROAD_LABEL_HALO_WIDTH * presentationScale, presentationScale, measureTextWidth: measureLineLabelText }))
}

export function updateHighlightStyle(map: maplibregl.Map, style: HighlightStyle, presentationScale = 1): void {
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-color', ['case', ['==', ['geometry-type'], 'LineString'], sceneLineColorExpression(style.roadColor, style.historicalRoadColor), style.regionColor])
  map.setPaintProperty(LAYER_IDS.highlightFill, 'fill-color', style.regionColor)
  map.setPaintProperty(LAYER_IDS.highlightPoint, 'circle-color', style.locationColor)
  map.setPaintProperty(LAYER_IDS.highlightPointGlow, 'circle-color', style.locationColor)
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-width', ['*', style.width, ['coalesce', ['get', 'illustrationWidthScale'], 1]])
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-opacity', style.opacity)
  const coreWidth = ['*', style.width, ['coalesce', ['get', 'illustrationWidthScale'], 1]]
  map.setPaintProperty(LAYER_IDS.highlightLineShadow, 'line-width', ['+', coreWidth, ACTIVE_LINE_SHADOW_EXTRA_WIDTH])
  map.setPaintProperty(LAYER_IDS.highlightLineOutline, 'line-width', ['+', coreWidth, ACTIVE_LINE_CASING_EXTRA_WIDTH])
  map.setPaintProperty(LAYER_IDS.highlightLineActive, 'line-width', coreWidth)
  map.setPaintProperty(LAYER_IDS.highlightLineActive, 'line-color', lineColorExpression(style.roadColor, style.historicalRoadColor))
  map.setPaintProperty(LAYER_IDS.highlightLineActive, 'line-opacity', style.opacity)
  map.setPaintProperty(LAYER_IDS.highlightRegionGlow, 'line-width', ['+', coreWidth, 7])
  map.setPaintProperty(LAYER_IDS.highlightRegionGlow, 'line-color', style.regionColor)
  map.setPaintProperty(LAYER_IDS.highlightRegionGlow, 'line-opacity', style.glow ? style.opacity * 0.65 : 0)
  map.setPaintProperty(LAYER_IDS.highlightFill, 'fill-opacity', style.opacity * 0.38)
  map.setPaintProperty(LAYER_IDS.highlightPoint, 'circle-opacity', style.opacity)
  map.setPaintProperty(LAYER_IDS.highlightPointGlow, 'circle-opacity', style.glow ? style.opacity * 0.24 : 0)
  const textSize = annotationTextSize(style.annotationSize, presentationScale)
  map.setLayoutProperty(LAYER_IDS.highlightLineLabels, 'text-size', textSize)
  map.setLayoutProperty(LAYER_IDS.highlightLabels, 'text-size', textSize)
  map.setPaintProperty(LAYER_IDS.highlightLineLabels, 'text-halo-width', ROAD_LABEL_HALO_WIDTH * presentationScale)
  map.setPaintProperty(LAYER_IDS.highlightLabels, 'text-halo-width', ROAD_LABEL_HALO_WIDTH * presentationScale)
  map.setPaintProperty(LAYER_IDS.highlightLineLabels, 'text-color', sceneLineColorExpression(style.roadColor, style.historicalRoadColor))
  map.setPaintProperty(LAYER_IDS.highlightLabels, 'text-color', ['match', ['geometry-type'], 'Polygon', style.regionColor, style.locationColor])
  map.setPaintProperty(LAYER_IDS.stations, 'text-color', style.stationColor)
  map.setPaintProperty(LAYER_IDS.selectedStationSymbol, 'text-color', style.stationColor)
  map.setPaintProperty(LAYER_IDS.historicalPosts, 'text-color', style.shukubaColor)
  map.setPaintProperty(LAYER_IDS.selectedShukubaSymbol, 'text-color', style.shukubaColor)
}
