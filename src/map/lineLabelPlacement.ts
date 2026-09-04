import type { Feature, FeatureCollection, Point, Position } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { EntityFeature, EntityProperties } from '../types/geo'

export interface ScreenPoint { x: number; y: number }
export interface Viewport { width: number; height: number }

const EPSILON = 1e-7
export const LABEL_SAFE_INSET = 30
export const LABEL_SAFE_HEIGHT_RATIO = 0.65
export const MAX_STITCH_GAP_PX = 12
export const MAX_STITCH_DIRECTION_DIFF_DEG = 45
export const LABEL_END_PADDING_PX = 12
export const MAX_FOLLOW_LABEL_ANGLE = 40
export const MAX_DIRECTION_DEVIATION_DEG = 15
export const HORIZONTAL_LABEL_OFFSET_FACTOR = 0.7
export const HORIZONTAL_LABEL_OFFSET_PADDING_PX = 6

export interface LineLabelPresentation {
  fontSize: number
  haloWidth: number
  presentationScale?: number
  measureTextWidth: (label: string, fontSize: number) => number
}
export type LineLabelMode = 'follow-road' | 'horizontal'
export type LineLabelAnchor = Feature<Point, EntityProperties & { bearing: number; labelMode?: LineLabelMode }>
export interface LineLabelCandidate { anchor: LineLabelAnchor; screenPoint: ScreenPoint }
export type VisualChain = ScreenPoint[][]

export function requiredLabelLength(label: string, presentation: LineLabelPresentation): number {
  const textWidth = presentation.measureTextWidth(label, presentation.fontSize)
  const scale = presentation.presentationScale ?? 1
  return textWidth + 2 * presentation.haloWidth + 2 * LABEL_END_PADDING_PX * scale
}

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

export function visualChainLength(chain: VisualChain): number {
  return chain.reduce((length, fragment) => length + polylineLength(fragment), 0)
}

function endpointDirection(fragment: ScreenPoint[], atStart: boolean): ScreenPoint | null {
  const endpoint = atStart ? fragment[0] : fragment[fragment.length - 1]
  for (let offset = 1; offset < fragment.length; offset += 1) {
    const inner = atStart ? fragment[offset] : fragment[fragment.length - 1 - offset]
    const vector = atStart
      ? { x: inner.x - endpoint.x, y: inner.y - endpoint.y }
      : { x: endpoint.x - inner.x, y: endpoint.y - inner.y }
    if (Math.hypot(vector.x, vector.y) > EPSILON) return vector
  }
  return null
}

function directionDifference(first: ScreenPoint, second: ScreenPoint): number {
  const dot = first.x * second.x + first.y * second.y
  const lengths = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y)
  return Math.acos(Math.max(-1, Math.min(1, dot / lengths))) * 180 / Math.PI
}

interface StitchMatch { fragmentIndex: number; reverse: boolean; prepend: boolean; gap: number }

function stitchMatch(chain: VisualChain, fragment: ScreenPoint[], fragmentIndex: number, maximumGap: number): StitchMatch | null {
  const options: StitchMatch[] = []
  for (const prepend of [false, true]) {
    for (const reverse of [false, true]) {
      const oriented = reverse ? [...fragment].reverse() : fragment
      const chainFragment = prepend ? chain[0] : chain[chain.length - 1]
      const chainPoint = prepend ? chainFragment[0] : chainFragment[chainFragment.length - 1]
      const candidatePoint = prepend ? oriented[oriented.length - 1] : oriented[0]
      const gap = Math.hypot(chainPoint.x - candidatePoint.x, chainPoint.y - candidatePoint.y)
      const chainDirection = endpointDirection(chainFragment, prepend)
      const candidateDirection = endpointDirection(oriented, !prepend)
      if (gap <= maximumGap && chainDirection && candidateDirection
        && directionDifference(chainDirection, candidateDirection) <= MAX_STITCH_DIRECTION_DIFF_DEG) {
        options.push({ fragmentIndex, reverse, prepend, gap })
      }
    }
  }
  return options.sort((a, b) => a.gap - b.gap || Number(a.prepend) - Number(b.prepend) || Number(a.reverse) - Number(b.reverse))[0] ?? null
}

/** Greedily joins only visually compatible screen-space fragments. */
export function stitchVisibleFragments(fragments: ScreenPoint[][], maximumGap: number): VisualChain[] {
  const unused = new Set(fragments.map((_, index) => index))
  const chains: VisualChain[] = []
  while (unused.size > 0) {
    const first = unused.values().next().value as number
    unused.delete(first)
    const chain: VisualChain = [fragments[first]]
    while (true) {
      const match = [...unused].flatMap((index) => {
        const candidate = stitchMatch(chain, fragments[index], index, maximumGap)
        return candidate ? [candidate] : []
      }).sort((a, b) => a.gap - b.gap || a.fragmentIndex - b.fragmentIndex)[0]
      if (!match) break
      const fragment = match.reverse ? [...fragments[match.fragmentIndex]].reverse() : fragments[match.fragmentIndex]
      if (match.prepend) chain.unshift(fragment)
      else chain.push(fragment)
      unused.delete(match.fragmentIndex)
    }
    chains.push(chain)
  }
  return chains
}

function pointAtVisualChainDistance(chain: VisualChain, target: number): { point: ScreenPoint; before: ScreenPoint; after: ScreenPoint } | null {
  const length = visualChainLength(chain)
  if (length <= EPSILON || target < -EPSILON || target > length + EPSILON) return null
  const clampedTarget = Math.max(0, Math.min(length, target))
  let travelled = 0
  for (const fragment of chain) {
    const fragmentLength = polylineLength(fragment)
    if (travelled + fragmentLength + EPSILON >= clampedTarget) {
      const localTarget = clampedTarget - travelled
      let localTravelled = 0
      for (let index = 1; index < fragment.length; index += 1) {
        const before = fragment[index - 1]
        const after = fragment[index]
        const segmentLength = Math.hypot(after.x - before.x, after.y - before.y)
        if (localTravelled + segmentLength + EPSILON >= localTarget && segmentLength > EPSILON) {
          const amount = Math.max(0, Math.min(1, (localTarget - localTravelled) / segmentLength))
          return { point: { x: before.x + (after.x - before.x) * amount, y: before.y + (after.y - before.y) * amount }, before, after }
        }
        localTravelled += segmentLength
      }
    }
    travelled += fragmentLength
  }
  return null
}

function pointAtVisualChainFraction(chain: VisualChain, fraction: number): { point: ScreenPoint; before: ScreenPoint; after: ScreenPoint } | null {
  return pointAtVisualChainDistance(chain, visualChainLength(chain) * fraction)
}

export function pointAtVisualChainMidpoint(chain: VisualChain): { point: ScreenPoint; before: ScreenPoint; after: ScreenPoint } | null {
  return pointAtVisualChainFraction(chain, 0.5)
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

function bearingDifference(first: number, second: number): number {
  let difference = Math.abs(first - second) % 180
  if (difference > 90) difference = 180 - difference
  return difference
}

interface FollowRoadPosition {
  point: ScreenPoint
  bearing: number
}

export function followRoadPositionAtFraction(chain: VisualChain, fraction: number, labelWidth: number): FollowRoadPosition | null {
  const chainLength = visualChainLength(chain)
  const centerDistance = chainLength * fraction
  const halfWindow = labelWidth / 2
  const startDistance = centerDistance - halfWindow
  const endDistance = centerDistance + halfWindow
  if (startDistance < 0 || endDistance > chainLength) return null

  const samples = [0, 0.25, 0.5, 0.75, 1].map((amount) => pointAtVisualChainDistance(chain, startDistance + labelWidth * amount)?.point)
  if (samples.some((sample) => !sample)) return null
  const points = samples as ScreenPoint[]
  const overallBearing = uprightBearing(points[0], points[points.length - 1])
  if (Math.abs(overallBearing) > MAX_FOLLOW_LABEL_ANGLE) return null

  for (let index = 1; index < points.length; index += 1) {
    const segmentBearing = uprightBearing(points[index - 1], points[index])
    if (bearingDifference(segmentBearing, overallBearing) > MAX_DIRECTION_DEVIATION_DEG) return null
  }

  const center = pointAtVisualChainDistance(chain, centerDistance)
  return center ? { point: center.point, bearing: overallBearing } : null
}

function lineComponents(feature: EntityFeature): Position[][] {
  if (feature.geometry.type === 'LineString') return [feature.geometry.coordinates]
  if (feature.geometry.type === 'MultiLineString') return feature.geometry.coordinates
  return []
}

interface LabelBox { left: number; top: number; right: number; bottom: number }

function candidateBox(candidate: LineLabelCandidate, presentation: LineLabelPresentation): LabelBox {
  const width = presentation.measureTextWidth(candidate.anchor.properties.name, presentation.fontSize) + presentation.haloWidth * 2
  const height = presentation.fontSize + presentation.haloWidth * 2
  const radians = candidate.anchor.properties.bearing * Math.PI / 180
  const boxWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
  const boxHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  return { left: candidate.screenPoint.x - boxWidth / 2, right: candidate.screenPoint.x + boxWidth / 2, top: candidate.screenPoint.y - boxHeight / 2, bottom: candidate.screenPoint.y + boxHeight / 2 }
}

function boxInsideSafeRegion(box: LabelBox, viewport: Viewport): boolean {
  return box.left >= 0 && box.right <= viewport.width && box.top >= 0 && box.bottom <= viewport.height * LABEL_SAFE_HEIGHT_RATIO
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function labelPriority(candidate: LineLabelCandidate): number {
  if (candidate.anchor.properties.activeLine || candidate.anchor.properties.sceneLineState === 'active') return 2
  if (candidate.anchor.properties.sceneLineState === 'selected') return 1
  return 0
}

export function resolveLineLabelOverlaps(groups: LineLabelCandidate[][], presentation: LineLabelPresentation): LineLabelAnchor[] {
  const accepted: { anchor: LineLabelAnchor; box: LabelBox }[] = []
  const ordered = groups.map((candidates, index) => ({ candidates, index }))
    .sort((a, b) => labelPriority(b.candidates[0]) - labelPriority(a.candidates[0]) || a.index - b.index)
  for (const { candidates } of ordered) {
    const choice = candidates.find((candidate) => {
      const box = candidateBox(candidate, presentation)
      return !accepted.some((item) => overlaps(item.box, box))
    })
    if (choice) accepted.push({ anchor: choice.anchor, box: candidateBox(choice, presentation) })
  }
  return accepted.map(({ anchor }) => anchor)
}

function makeCandidate(
  map: Pick<maplibregl.Map, 'unproject'>,
  feature: EntityFeature,
  screenPoint: ScreenPoint,
  bearing: number,
  labelMode: LineLabelMode,
): LineLabelCandidate {
  const coordinate = map.unproject([screenPoint.x, screenPoint.y]).toArray()
  return {
    screenPoint,
    anchor: {
      type: 'Feature',
      properties: { ...feature.properties, bearing, labelMode },
      geometry: { type: 'Point', coordinates: coordinate },
    },
  }
}

function horizontalFallbackCandidates(
  map: Pick<maplibregl.Map, 'unproject'>,
  feature: EntityFeature,
  chain: VisualChain,
  viewport: Viewport,
  presentation: LineLabelPresentation,
): LineLabelCandidate[] {
  const scale = presentation.presentationScale ?? 1
  const offset = presentation.fontSize * HORIZONTAL_LABEL_OFFSET_FACTOR + presentation.haloWidth + HORIZONTAL_LABEL_OFFSET_PADDING_PX * scale
  const candidates: LineLabelCandidate[] = []
  for (const fraction of [0.5, 0.3, 0.7]) {
    const position = pointAtVisualChainFraction(chain, fraction)
    if (!position) continue
    const dx = position.after.x - position.before.x
    const dy = position.after.y - position.before.y
    const tangentLength = Math.hypot(dx, dy)
    if (tangentLength <= EPSILON) continue
    const perpendicular = { x: -dy / tangentLength, y: dx / tangentLength }
    const offsetPoints = [1, -1].map((side) => ({ x: position.point.x + perpendicular.x * offset * side, y: position.point.y + perpendicular.y * offset * side }))
    const valid = offsetPoints
      .map((point) => makeCandidate(map, feature, point, 0, 'horizontal'))
      .filter((candidate) => boxInsideSafeRegion(candidateBox(candidate, presentation), viewport))
    candidates.push(...valid)
    if (valid.length === 0) {
      const centered = makeCandidate(map, feature, position.point, 0, 'horizontal')
      if (boxInsideSafeRegion(candidateBox(centered, presentation), viewport)) candidates.push(centered)
    }
  }
  return candidates
}

export function buildLineLabelAnchors(map: Pick<maplibregl.Map, 'project' | 'unproject' | 'getCanvas'>, features: EntityFeature[], presentation?: LineLabelPresentation): FeatureCollection<Point, EntityProperties & { bearing: number; labelMode?: LineLabelMode }> {
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

  const candidateGroups: LineLabelCandidate[][] = []
  for (const { feature, lines } of logicalLines.values()) {
    const projectedLines = lines.map((line) => line.map((coordinate) => {
      const projected = map.project(coordinate as [number, number])
      return { x: projected.x, y: projected.y }
    }))
    const stitchGap = MAX_STITCH_GAP_PX * (presentation?.presentationScale ?? 1)
    const bestChain = (fragments: ScreenPoint[][]) => stitchVisibleFragments(fragments, stitchGap)
      .reduce<VisualChain | null>((best, chain) => !best || visualChainLength(chain) > visualChainLength(best) ? chain : best, null)

    const safeViewport = { width: viewport.width, height: viewport.height * LABEL_SAFE_HEIGHT_RATIO }
    const safeBest = bestChain(projectedLines.flatMap((line) => visibleLineFragments(line, safeViewport)))
    const safeMidpoint = safeBest ? pointAtVisualChainMidpoint(safeBest) : null
    const safelyInset = safeMidpoint && safeMidpoint.point.x >= LABEL_SAFE_INSET && safeMidpoint.point.x <= viewport.width - LABEL_SAFE_INSET
      && safeMidpoint.point.y >= LABEL_SAFE_INSET
    const best = safelyInset ? safeBest : bestChain(projectedLines.flatMap((line) => preferredLabelFragments(line, viewport))) ?? safeBest
    if (!best) continue

    if (presentation && visualChainLength(best) < requiredLabelLength(feature.properties.name, presentation)) continue

    if (!presentation) {
      const candidates = [0.5, 0.3, 0.7].flatMap((fraction): LineLabelCandidate[] => {
        const position = pointAtVisualChainFraction(best, fraction)
        if (!position || position.point.y > viewport.height * LABEL_SAFE_HEIGHT_RATIO) return []
        return [makeCandidate(map, feature, position.point, uprightBearing(position.before, position.after), 'follow-road')]
      })
      if (candidates.length > 0) candidateGroups.push(candidates)
      continue
    }

    const renderedLabelWidth = presentation.measureTextWidth(feature.properties.name, presentation.fontSize) + 2 * presentation.haloWidth
    const followCandidates = [0.5, 0.3, 0.7, 0.2, 0.8].flatMap((fraction): LineLabelCandidate[] => {
      const position = followRoadPositionAtFraction(best, fraction, renderedLabelWidth)
      if (!position || position.point.y > viewport.height * LABEL_SAFE_HEIGHT_RATIO) return []
      const candidate = makeCandidate(map, feature, position.point, position.bearing, 'follow-road')
      return boxInsideSafeRegion(candidateBox(candidate, presentation), viewport) ? [candidate] : []
    })

    const candidates = followCandidates.length > 0
      ? followCandidates
      : horizontalFallbackCandidates(map, feature, best, viewport, presentation)
    if (candidates.length > 0) candidateGroups.push(candidates)
  }
  return { type: 'FeatureCollection', features: presentation ? resolveLineLabelOverlaps(candidateGroups, presentation) : candidateGroups.map((group) => group[0].anchor) }
}
