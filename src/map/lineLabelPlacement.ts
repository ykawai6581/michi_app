import type { Feature, FeatureCollection, Point, Position } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { EntityFeature, EntityProperties } from '../types/geo'

export interface ScreenPoint { x: number; y: number }
export interface Viewport { width: number; height: number }

const EPSILON = 1e-7
export const LABEL_SAFE_INSET = 30
export const LABEL_SAFE_HEIGHT_RATIO = 0.65

/** Clips a screen-space segment to the canvas rectangle using Liang-Barsky. */
export function clipSegmentToViewport(start: ScreenPoint, end: ScreenPoint, viewport: Viewport): [ScreenPoint, ScreenPoint] | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const p = [-dx, dx, -dy, dy]
  const q = [start.x, viewport.width - start.x, start.y, viewport.height - start.y]
  let entering = 0
  let leaving = 1
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < EPSILON) {
      if (q[index] < 0) return null
      continue
    }
    const ratio = q[index] / p[index]
    if (p[index] < 0) entering = Math.max(entering, ratio)
    else leaving = Math.min(leaving, ratio)
    if (entering > leaving) return null
  }
  return [
    { x: start.x + entering * dx, y: start.y + entering * dy },
    { x: start.x + leaving * dx, y: start.y + leaving * dy },
  ]
}

function samePoint(a: ScreenPoint, b: ScreenPoint): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

export function visibleLineFragments(line: ScreenPoint[], viewport: Viewport): ScreenPoint[][] {
  const fragments: ScreenPoint[][] = []
  let current: ScreenPoint[] = []
  const flush = () => {
    if (current.length > 1 && polylineLength(current) > EPSILON) fragments.push(current)
    current = []
  }
  for (let index = 1; index < line.length; index += 1) {
    const clipped = clipSegmentToViewport(line[index - 1], line[index], viewport)
    if (!clipped) {
      flush()
    } else if (current.length === 0) {
      current = clipped
    } else if (samePoint(current[current.length - 1], clipped[0])) {
      if (!samePoint(clipped[0], clipped[1])) current.push(clipped[1])
    } else {
      flush()
      current = clipped
    }
  }
  flush()
  return fragments
}

function preferredLabelFragments(line: ScreenPoint[], viewport: Viewport): ScreenPoint[][] {
  const safeHeight = viewport.height * LABEL_SAFE_HEIGHT_RATIO
  const inset = Math.min(LABEL_SAFE_INSET, viewport.width / 2, safeHeight)
  const translated = line.map(({ x, y }) => ({ x: x - inset, y: y - inset }))
  return visibleLineFragments(translated, { width: viewport.width - inset * 2, height: safeHeight - inset })
    .map((fragment) => fragment.map(({ x, y }) => ({ x: x + inset, y: y + inset })))
}

export function polylineLength(line: ScreenPoint[]): number {
  return line.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - line[index].x, point.y - line[index].y), 0)
}

export function pointAtPolylineMidpoint(line: ScreenPoint[]): { point: ScreenPoint; before: ScreenPoint; after: ScreenPoint } | null {
  const length = polylineLength(line)
  if (length <= EPSILON) return null
  const target = length / 2
  let travelled = 0
  for (let index = 1; index < line.length; index += 1) {
    const before = line[index - 1]
    const after = line[index]
    const segmentLength = Math.hypot(after.x - before.x, after.y - before.y)
    if (travelled + segmentLength >= target && segmentLength > EPSILON) {
      const amount = (target - travelled) / segmentLength
      return { point: { x: before.x + (after.x - before.x) * amount, y: before.y + (after.y - before.y) * amount }, before, after }
    }
    travelled += segmentLength
  }
  return null
}

export function uprightBearing(before: ScreenPoint, after: ScreenPoint): number {
  let angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  return angle
}

function lineComponents(feature: EntityFeature): Position[][] {
  if (feature.geometry.type === 'LineString') return [feature.geometry.coordinates]
  if (feature.geometry.type === 'MultiLineString') return feature.geometry.coordinates
  return []
}

export type LineLabelAnchor = Feature<Point, EntityProperties & { bearing: number }>

export function buildLineLabelAnchors(map: Pick<maplibregl.Map, 'project' | 'unproject' | 'getCanvas'>, features: EntityFeature[]): FeatureCollection<Point, EntityProperties & { bearing: number }> {
  const canvas = map.getCanvas()
  const viewport = { width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height }
  const logicalLines = new Map<string, { feature: EntityFeature; lines: Position[][] }>()
  for (const feature of features) {
    if (feature.properties.type !== 'road' && feature.properties.type !== 'railway') continue
    const lines = lineComponents(feature)
    if (lines.length === 0) continue
    const existing = logicalLines.get(feature.properties.id)
    if (existing) existing.lines.push(...lines)
    else logicalLines.set(feature.properties.id, { feature, lines: [...lines] })
  }

  const anchors: LineLabelAnchor[] = []
  for (const { feature, lines } of logicalLines.values()) {
    const projectedLines = lines.map((line) => line.map((coordinate) => {
      const projected = map.project(coordinate as [number, number])
      return { x: projected.x, y: projected.y }
    }))
    const longest = (fragments: ScreenPoint[][]) => fragments.reduce<ScreenPoint[] | null>((best, fragment) => !best || polylineLength(fragment) > polylineLength(best) ? fragment : best, null)
    // Clip candidates to actual road geometry in the caption-safe portion of the
    // map canvas. Prefer an edge inset, but retain a safe-area fragment when the
    // road only appears close to an edge.
    const safeViewport = { width: viewport.width, height: viewport.height * LABEL_SAFE_HEIGHT_RATIO }
    const safeBest = longest(projectedLines.flatMap((line) => visibleLineFragments(line, safeViewport)))
    const safeMidpoint = safeBest ? pointAtPolylineMidpoint(safeBest) : null
    const safelyInset = safeMidpoint && safeMidpoint.point.x >= LABEL_SAFE_INSET && safeMidpoint.point.x <= viewport.width - LABEL_SAFE_INSET
      && safeMidpoint.point.y >= LABEL_SAFE_INSET
    const best = safelyInset ? safeBest : longest(projectedLines.flatMap((line) => preferredLabelFragments(line, viewport))) ?? safeBest
    if (!best) continue
    const midpoint = pointAtPolylineMidpoint(best)
    if (!midpoint) continue
    const coordinate = map.unproject([midpoint.point.x, midpoint.point.y]).toArray()
    anchors.push({
      type: 'Feature',
      properties: { ...feature.properties, bearing: uprightBearing(midpoint.before, midpoint.after) },
      geometry: { type: 'Point', coordinates: coordinate },
    })
  }
  return { type: 'FeatureCollection', features: anchors }
}
