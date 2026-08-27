import type { MultiLineString, Position } from 'geojson'
import type { EntityFeature, RoadSegmentProvenance } from '../types/geo'

// COINS/every-best-fit baseline following Thomson & Richardson (1999),
// Zhou & Li (2012, DOI 10.1080/13658816.2011.609990), and Tripathy et al.
// (2021, DOI 10.1177/2399808320967680): segmentize, choose the maximum
// continuation angle at each end, cross-check mutual best links, then recurse.

export interface CoinsOptions {
  snapToleranceMeters: number
  angleThreshold: number
  tieToleranceDegrees: number
}

export const DEFAULT_COINS_OPTIONS: CoinsOptions = {
  snapToleranceMeters: 0.75,
  angleThreshold: 120,
  tieToleranceDegrees: 0.1,
}

interface Node { id: number; coordinate: Position; segments: number[] }
interface Segment {
  index: number
  id: string
  sourceId: string
  osmId?: number
  name: string
  ref: string
  highway: string
  nodes: [number, number]
  coordinates: [Position, Position]
}
interface Candidate { segment: number; angle: number }
interface EndDebug {
  nodeId: number
  candidates: Candidate[]
  best: number | null
  mutualLink: number | null
  rejectedReason?: 'topology_break' | 'below_angle_threshold' | 'not_mutual_best' | 'ambiguous' | 'semantic_conflict'
}
export interface CoinsSegmentDebug {
  segmentId: string
  originalFeatureId: string
  osmId?: number
  name: string
  ref: string
  highway: string
  endpoint1: EndDebug
  endpoint2: EndDebug
  strokeId: number
}
export interface CoinsResult {
  strokes: number[][]
  segments: Segment[]
  nodes: Node[]
  debug: CoinsSegmentDebug[]
}

const radians = (degrees: number) => degrees * Math.PI / 180
const normalize = (value = '') => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const distanceMeters = (left: Position, right: Position) => {
  const latitude = radians((left[1] + right[1]) / 2)
  return Math.hypot((left[0] - right[0]) * 111_320 * Math.cos(latitude), (left[1] - right[1]) * 110_540)
}

function continuationAngle(left: Segment, right: Segment, nodeId: number): number {
  const vector = (segment: Segment) => {
    const atStart = segment.nodes[0] === nodeId
    const from = atStart ? segment.coordinates[0] : segment.coordinates[1]
    const to = atStart ? segment.coordinates[1] : segment.coordinates[0]
    const latitude = radians((from[1] + to[1]) / 2)
    return [(to[0] - from[0]) * Math.cos(latitude), to[1] - from[1]]
  }
  const a = vector(left); const b = vector(right)
  const cosine = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))))
  return Math.acos(cosine) * 180 / Math.PI
}

function segmentize(features: EntityFeature[], options: CoinsOptions): { nodes: Node[]; segments: Segment[] } {
  const nodes: Node[] = []
  const grid = new Map<string, number[]>()
  const cellSize = options.snapToleranceMeters / 80_000
  const nodeFor = (coordinate: Position) => {
    const x = Math.floor(coordinate[0] / cellSize); const y = Math.floor(coordinate[1] / cellSize)
    for (let nearX = x - 1; nearX <= x + 1; nearX += 1) for (let nearY = y - 1; nearY <= y + 1; nearY += 1) {
      for (const candidate of grid.get(`${nearX}:${nearY}`) ?? []) if (distanceMeters(nodes[candidate].coordinate, coordinate) <= options.snapToleranceMeters) return candidate
    }
    const id = nodes.length
    nodes.push({ id, coordinate, segments: [] })
    grid.set(`${x}:${y}`, [...(grid.get(`${x}:${y}`) ?? []), id])
    return id
  }
  const segments: Segment[] = []
  features.filter((feature) => feature.properties.type === 'road' && feature.geometry.type === 'LineString').forEach((feature) => {
    if (feature.geometry.type !== 'LineString') return
    const coordinates = feature.geometry.coordinates
    coordinates.slice(1).forEach((coordinate, part) => {
      const previous = coordinates[part]
      const nodesForSegment: [number, number] = [nodeFor(previous), nodeFor(coordinate)]
      if (nodesForSegment[0] === nodesForSegment[1]) return
      const segment: Segment = { index: segments.length, id: `${feature.properties.id}:${part}`, sourceId: feature.properties.id, osmId: feature.properties.osm_id, name: feature.properties.name ?? '', ref: feature.properties.ref ?? '', highway: feature.properties.highway ?? '', nodes: nodesForSegment, coordinates: [previous, coordinate] }
      segments.push(segment)
      nodesForSegment.forEach((node) => nodes[node].segments.push(segment.index))
    })
  })
  return { nodes, segments }
}

function thematicTieBreak(current: Segment, candidates: Candidate[], segments: Segment[]): Candidate | null {
  const rank = (candidate: Candidate) => {
    const other = segments[candidate.segment]
    return [Number(Boolean(current.highway) && current.highway === other.highway), Number(Boolean(current.ref) && current.ref === other.ref), Number(Boolean(current.name) && normalize(current.name) === normalize(other.name))]
  }
  const ranked = candidates.map((candidate) => ({ candidate, rank: rank(candidate) })).sort((left, right) => right.rank[0] - left.rank[0] || right.rank[1] - left.rank[1] || right.rank[2] - left.rank[2])
  if (ranked.length > 1 && ranked[0].rank.every((value, index) => value === ranked[1].rank[index])) return null
  return ranked[0]?.candidate ?? null
}

function bestAtEndpoint(segment: Segment, nodeId: number, nodes: Node[], segments: Segment[], options: CoinsOptions): { candidates: Candidate[]; best: number | null; rejectedReason?: EndDebug['rejectedReason'] } {
  const candidates = nodes[nodeId].segments.filter((candidate) => candidate !== segment.index)
    .map((candidate) => ({ segment: candidate, angle: continuationAngle(segment, segments[candidate], nodeId) }))
    .sort((left, right) => right.angle - left.angle)
  if (!candidates.length) return { candidates, best: null, rejectedReason: 'topology_break' }
  if (candidates[0].angle < options.angleThreshold) return { candidates, best: null, rejectedReason: 'below_angle_threshold' }
  const tied = candidates.filter((candidate) => Math.abs(candidate.angle - candidates[0].angle) <= options.tieToleranceDegrees)
  if (tied.length === 1) return { candidates, best: tied[0].segment }
  const thematic = thematicTieBreak(segment, tied, segments)
  return thematic ? { candidates, best: thematic.segment } : { candidates, best: null, rejectedReason: 'ambiguous' }
}

function unionFind(size: number) {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]))
  return { find, union: (left: number, right: number) => { const a = find(left); const b = find(right); if (a !== b) parent[b] = a } }
}

export function generateCoinsStrokes(features: EntityFeature[], supplied: Partial<CoinsOptions> = {}): CoinsResult {
  const options = { ...DEFAULT_COINS_OPTIONS, ...supplied }
  const { nodes, segments } = segmentize(features, options)
  const endpointResults = segments.map((segment) => segment.nodes.map((node) => bestAtEndpoint(segment, node, nodes, segments, options)) as [ReturnType<typeof bestAtEndpoint>, ReturnType<typeof bestAtEndpoint>])
  const groups = unionFind(segments.length)
  const mutual = (segmentIndex: number, end: 0 | 1) => {
    const best = endpointResults[segmentIndex][end].best
    if (best === null) return null
    const node = segments[segmentIndex].nodes[end]
    const otherEnd = segments[best].nodes[0] === node ? 0 : 1
    if (endpointResults[best][otherEnd].best !== segmentIndex) return null
    groups.union(segmentIndex, best)
    return best
  }
  const mutualLinks = segments.map((_, index) => [mutual(index, 0), mutual(index, 1)] as [number | null, number | null])
  const grouped = new Map<number, number[]>()
  segments.forEach((_, index) => { const root = groups.find(index); grouped.set(root, [...(grouped.get(root) ?? []), index]) })
  const strokes = [...grouped.values()]
  const strokeFor = new Map(strokes.flatMap((stroke, strokeId) => stroke.map((segment) => [segment, strokeId] as const)))
  const debug = segments.map((segment, index): CoinsSegmentDebug => ({
    segmentId: segment.id, originalFeatureId: segment.sourceId, osmId: segment.osmId, name: segment.name, ref: segment.ref, highway: segment.highway, strokeId: strokeFor.get(index) ?? -1,
    endpoint1: { nodeId: segment.nodes[0], ...endpointResults[index][0], mutualLink: mutualLinks[index][0], rejectedReason: endpointResults[index][0].rejectedReason ?? (endpointResults[index][0].best !== null && mutualLinks[index][0] === null ? 'not_mutual_best' : undefined) },
    endpoint2: { nodeId: segment.nodes[1], ...endpointResults[index][1], mutualLink: mutualLinks[index][1], rejectedReason: endpointResults[index][1].rejectedReason ?? (endpointResults[index][1].best !== null && mutualLinks[index][1] === null ? 'not_mutual_best' : undefined) },
  }))
  return { strokes, segments, nodes, debug }
}

function linesForStroke(stroke: number[], result: CoinsResult): Position[][] {
  const unused = new Set(stroke); const lines: Position[][] = []
  while (unused.size) {
    const degree = new Map<number, number>()
    unused.forEach((index) => result.segments[index].nodes.forEach((node) => degree.set(node, (degree.get(node) ?? 0) + 1)))
    const first = unused.values().next().value as number
    let node = [...degree].find(([, value]) => value === 1)?.[0] ?? result.segments[first].nodes[0]
    const line = [result.nodes[node].coordinate]
    while (true) {
      const next = result.nodes[node].segments.find((index) => unused.has(index))
      if (next === undefined) break
      unused.delete(next)
      const segment = result.segments[next]
      node = segment.nodes[0] === node ? segment.nodes[1] : segment.nodes[0]
      line.push(result.nodes[node].coordinate)
    }
    if (line.length > 1) lines.push(line)
  }
  return lines
}

export function buildLogicalRoadEntities(features: EntityFeature[], names: string[], supplied: Partial<CoinsOptions> = {}): EntityFeature[] {
  const result = generateCoinsStrokes(features, supplied)
  const targetNames = new Set(names.map(normalize))
  const networkCoverage = result.segments.some((segment) => !targetNames.has(normalize(segment.name))) ? 'corridor' : 'seed_only'
  return names.flatMap((name) => {
    const exactSeeds = new Set(result.segments.filter((segment) => normalize(segment.name) === normalize(name)).map((segment) => segment.index))
    if (!exactSeeds.size) return []
    const selectedStrokes = result.strokes.map((stroke, strokeId) => ({ stroke, strokeId })).filter(({ stroke }) => stroke.some((segment) => exactSeeds.has(segment)))
    const included = [...new Set(selectedStrokes.flatMap(({ stroke }) => stroke))]
    const sourceIds = [...new Set(included.map((index) => result.segments[index].sourceId))]
    const seedSourceIds = [...new Set([...exactSeeds].map((index) => result.segments[index].sourceId))]
    const sourceFeatures = features.filter((feature) => seedSourceIds.includes(feature.properties.id) && feature.geometry.type === 'LineString')
    const segmentProvenance: RoadSegmentProvenance[] = included.map((index) => ({ segmentId: result.segments[index].id, sourceId: result.segments[index].sourceId, osmId: result.segments[index].osmId, method: exactSeeds.has(index) ? 'direct_source' : 'stroke_continuation', confidence: 1, inferred: !exactSeeds.has(index) }))
    const geometry: MultiLineString = { type: 'MultiLineString', coordinates: selectedStrokes.flatMap(({ stroke }) => linesForStroke(stroke, result)) }
    const coinsDebug = result.debug.filter(({ strokeId }) => selectedStrokes.some((selected) => selected.strokeId === strokeId))
    const rejected = coinsDebug.flatMap((debug) => [debug.endpoint1.rejectedReason, debug.endpoint2.rejectedReason])
    const coinsDiagnostics = { networkCoverage, topologyBreaks: rejected.filter((reason) => reason === 'topology_break').length, notMutualBest: rejected.filter((reason) => reason === 'not_mutual_best').length, belowAngleThreshold: rejected.filter((reason) => reason === 'below_angle_threshold').length, ambiguous: rejected.filter((reason) => reason === 'ambiguous').length }
    return [{ type: 'Feature', properties: { id: `logical-road-${normalize(name)}`, name, aliases: [], type: 'road', method: 'stroke_continuation', confidence: 1, directlySourced: included.every((segment) => exactSeeds.has(segment)), sourceSegmentIds: sourceIds, osmIds: [...new Set(included.map((index) => result.segments[index].osmId).filter((id): id is number => id !== undefined))], segmentProvenance, strokeCount: selectedStrokes.length, coinsDebug, coinsDiagnostics, sourceGeometry: { type: 'MultiLineString', coordinates: sourceFeatures.map((feature) => feature.geometry.type === 'LineString' ? feature.geometry.coordinates : []) }, illustrationWidthScale: 1.4 }, geometry } as EntityFeature]
  })
}
