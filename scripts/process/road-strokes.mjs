import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const DEFAULT_STROKE_OPTIONS = {
  snapToleranceMeters: 0.75,
  maxDeflectionDegrees: 45,
  maxGapDistanceMeters: 250,
  maxCandidatePathMeters: 600,
  maxPathDeflectionDegrees: 75,
  maxGraphTurns: 4,
  minimumConfidence: 0.72,
  ambiguityMargin: 0.1,
}

const normalize = (value = '') => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const radians = (degrees) => degrees * Math.PI / 180
const distanceMeters = (a, b) => {
  const latitude = radians((a[1] + b[1]) / 2)
  return Math.hypot((a[0] - b[0]) * 111_320 * Math.cos(latitude), (a[1] - b[1]) * 110_540)
}
const vectorAway = (edge, nodeId) => {
  const fromStart = edge.a === nodeId
  const from = fromStart ? edge.coordinates[0] : edge.coordinates[1]
  const to = fromStart ? edge.coordinates[1] : edge.coordinates[0]
  const latitude = radians((from[1] + to[1]) / 2)
  return [(to[0] - from[0]) * Math.cos(latitude), to[1] - from[1]]
}
export const deflectionDegrees = (left, right, nodeId) => {
  const a = vectorAway(left, nodeId); const b = vectorAway(right, nodeId)
  const cosine = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))))
  return 180 - Math.acos(cosine) * 180 / Math.PI
}

export function continuationScore(current, candidate, nodeId, profile = {}) {
  const deflection = deflectionDegrees(current, candidate, nodeId)
  const nameMatch = normalize(candidate.name) !== '' && normalize(candidate.name) === normalize(profile.name ?? current.name)
  const refMatch = normalize(candidate.ref) !== '' && normalize(candidate.ref) === normalize(profile.ref ?? current.ref)
  const classMatch = candidate.highway && candidate.highway === (profile.highway ?? current.highway)
  return { deflection, nameMatch, refMatch, classMatch, score: 100 - deflection * 1.5 + (nameMatch ? 28 : 0) + (refMatch ? 12 : 0) + (classMatch ? 8 : 0) }
}

function unionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (value) => parent[value] === value ? value : (parent[value] = find(parent[value]))
  return { find, union: (a, b) => { const left = find(a); const right = find(b); if (left !== right) parent[right] = left } }
}

export function buildRoadNetwork(collection, options = {}) {
  const settings = { ...DEFAULT_STROKE_OPTIONS, ...options }
  const roads = collection.features.filter((feature) => feature.geometry?.type === 'LineString' && feature.properties?.type === 'road')
  const nodes = []
  const nodeGrid = new Map()
  const gridSize = settings.snapToleranceMeters / 80_000
  const nodeFor = (coordinate) => {
    const gridX = Math.floor(coordinate[0] / gridSize); const gridY = Math.floor(coordinate[1] / gridSize)
    for (let x = gridX - 1; x <= gridX + 1; x += 1) for (let y = gridY - 1; y <= gridY + 1; y += 1) {
      for (const candidate of nodeGrid.get(`${x}:${y}`) ?? []) if (distanceMeters(nodes[candidate].coordinate, coordinate) <= settings.snapToleranceMeters) return candidate
    }
    nodes.push({ id: nodes.length, coordinate, edges: [] })
    nodeGrid.set(`${gridX}:${gridY}`, [...(nodeGrid.get(`${gridX}:${gridY}`) ?? []), nodes.length - 1])
    return nodes.length - 1
  }
  const edges = []
  roads.forEach((feature) => feature.geometry.coordinates.slice(1).forEach((coordinate, part) => {
    const previous = feature.geometry.coordinates[part]
    const a = nodeFor(previous); const b = nodeFor(coordinate)
    if (a === b) return
    const properties = feature.properties
    const edge = { id: `${properties.id}:${part}`, sourceId: properties.id, osmId: properties.osm_id, name: properties.name ?? '', ref: properties.ref ?? '', highway: properties.highway ?? '', a, b, coordinates: [previous, coordinate], length: distanceMeters(previous, coordinate), sourceFeature: feature }
    edges.push(edge); nodes[a].edges.push(edges.length - 1); nodes[b].edges.push(edges.length - 1)
  }))
  return { nodes, edges, settings }
}

function strokeComponents(network, seedIndexes, targetName) {
  const seedSet = new Set(seedIndexes)
  const position = new Map(seedIndexes.map((edgeIndex, index) => [edgeIndex, index]))
  const groups = unionFind(seedIndexes.length)
  network.nodes.forEach((node) => {
    const candidates = node.edges.filter((edge) => seedSet.has(edge))
    const best = new Map()
    candidates.forEach((edgeIndex) => {
      const alternatives = candidates.filter((candidate) => candidate !== edgeIndex)
        .map((candidate) => ({ candidate, ...continuationScore(network.edges[edgeIndex], network.edges[candidate], node.id, { name: targetName }) }))
        .filter(({ deflection }) => deflection <= network.settings.maxDeflectionDegrees)
        .sort((left, right) => right.score - left.score)
      if (alternatives[0]) best.set(edgeIndex, alternatives[0].candidate)
    })
    best.forEach((candidate, edgeIndex) => { if (best.get(candidate) === edgeIndex) groups.union(position.get(edgeIndex), position.get(candidate)) })
  })
  const components = new Map()
  seedIndexes.forEach((edgeIndex, index) => { const root = groups.find(index); components.set(root, [...(components.get(root) ?? []), edgeIndex]) })
  return [...components.values()]
}

function componentEndpoints(component, network) {
  const degree = new Map()
  component.forEach((edgeIndex) => { const edge = network.edges[edgeIndex]; degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1); degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1) })
  return [...degree.entries()].filter(([, count]) => count === 1).map(([node]) => node)
}

function pathConfidence(path, network, targetProfile) {
  const edges = path.edges.map((index) => network.edges[index])
  const mismatchRatio = edges.filter((edge) => normalize(edge.name) !== normalize(targetProfile.name) && normalize(edge.ref) !== normalize(targetProfile.ref)).length / Math.max(1, edges.length)
  const classChanges = edges.filter((edge) => targetProfile.highway && edge.highway && edge.highway !== targetProfile.highway).length
  const confidence = 1 - path.length / network.settings.maxCandidatePathMeters * 0.3 - path.totalTurn / (network.settings.maxGraphTurns * network.settings.maxPathDeflectionDegrees) * 0.25 - mismatchRatio * 0.25 - classChanges / Math.max(1, edges.length) * 0.15
  return Math.max(0, Math.min(1, confidence))
}

function findPaths(network, startNode, goalNode, forbiddenEdges, targetProfile, limit = 2) {
  const queue = [{ node: startNode, previousEdge: null, edges: [], length: 0, totalTurn: 0, turns: 0, cost: 0 }]
  const best = new Map()
  const results = []
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost)
    const state = queue.shift()
    if (state.node === goalNode && state.edges.length) {
      results.push({ ...state, confidence: pathConfidence(state, network, targetProfile) })
      if (results.length >= limit) return results
      continue
    }
    const key = `${state.node}:${state.previousEdge ?? 'start'}`
    if ((best.get(key) ?? Infinity) <= state.cost) continue
    best.set(key, state.cost)
    for (const edgeIndex of network.nodes[state.node].edges) {
      if (forbiddenEdges.has(edgeIndex) || state.edges.includes(edgeIndex)) continue
      const edge = network.edges[edgeIndex]
      const length = state.length + edge.length
      if (length > network.settings.maxCandidatePathMeters) continue
      const deflection = state.previousEdge === null ? 0 : deflectionDegrees(network.edges[state.previousEdge], edge, state.node)
      if (deflection > network.settings.maxPathDeflectionDegrees) continue
      const turns = state.turns + Number(deflection > 20)
      if (turns > network.settings.maxGraphTurns) continue
      const mismatch = normalize(edge.name) !== normalize(targetProfile.name) && normalize(edge.ref) !== normalize(targetProfile.ref)
      const classChange = targetProfile.highway && edge.highway && edge.highway !== targetProfile.highway
      const nextNode = edge.a === state.node ? edge.b : edge.a
      const cost = state.cost + edge.length + deflection * 2 + Number(mismatch) * 80 + Number(classChange) * 45
      queue.push({ node: nextNode, previousEdge: edgeIndex, edges: [...state.edges, edgeIndex], length, totalTurn: state.totalTurn + deflection, turns, cost })
    }
  }
  return results
}

function linesForComponent(edgeIndexes, network) {
  const unused = new Set(edgeIndexes)
  const lines = []
  while (unused.size) {
    const degrees = new Map()
    unused.forEach((index) => { const edge = network.edges[index]; degrees.set(edge.a, (degrees.get(edge.a) ?? 0) + 1); degrees.set(edge.b, (degrees.get(edge.b) ?? 0) + 1) })
    const firstIndex = unused.values().next().value
    let node = [...degrees].find(([, degree]) => degree === 1)?.[0] ?? network.edges[firstIndex].a
    const coordinates = [network.nodes[node].coordinate]
    let previousEdge = null
    while (true) {
      const candidates = network.nodes[node].edges.filter((index) => unused.has(index))
      if (!candidates.length) break
      candidates.sort((left, right) => previousEdge === null ? 0 : continuationScore(network.edges[previousEdge], network.edges[right], node).score - continuationScore(network.edges[previousEdge], network.edges[left], node).score)
      const edgeIndex = candidates[0]; const edge = network.edges[edgeIndex]
      unused.delete(edgeIndex)
      node = edge.a === node ? edge.b : edge.a
      coordinates.push(network.nodes[node].coordinate)
      previousEdge = edgeIndex
    }
    if (coordinates.length > 1) lines.push(coordinates)
  }
  return lines
}

export function reconstructLogicalRoad(collection, targetName, options = {}) {
  const network = buildRoadNetwork(collection, options)
  const seedIndexes = network.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => normalize(edge.name) === normalize(targetName)).map(({ index }) => index)
  if (!seedIndexes.length) return null
  let components = strokeComponents(network, seedIndexes, targetName)
  const initialComponents = components.map((component) => [...component])
  const inferred = []
  const seedSet = new Set(seedIndexes)
  const firstSeed = network.edges[seedIndexes[0]]
  const profile = { name: targetName, ref: firstSeed.ref, highway: firstSeed.highway }
  let changed = true
  while (changed && components.length > 1) {
    changed = false
    const candidates = []
    for (let left = 0; left < components.length; left += 1) for (let right = left + 1; right < components.length; right += 1) {
      for (const from of componentEndpoints(components[left], network)) for (const to of componentEndpoints(components[right], network)) {
        const gapDistance = distanceMeters(network.nodes[from].coordinate, network.nodes[to].coordinate)
        if (gapDistance > network.settings.maxGapDistanceMeters) continue
        const paths = findPaths(network, from, to, seedSet, profile)
        paths.filter((path) => path.confidence >= network.settings.minimumConfidence)
          .forEach((path) => candidates.push({ left, right, from, to, gapDistance, ...path }))
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence || a.cost - b.cost)
    const winner = candidates[0]
    if (!winner || (candidates[1] && candidates[1].left === winner.left && candidates[1].right === winner.right && winner.confidence - candidates[1].confidence < network.settings.ambiguityMargin)) break
    inferred.push({ method: 'graph_gap_completion', confidence: winner.confidence, sourceComponentEdgeIds: [...components[winner.left], ...components[winner.right]].map((index) => network.edges[index].id), inferredPathSegmentIds: winner.edges.map((index) => network.edges[index].id), inferredSourceIds: [...new Set(winner.edges.map((index) => network.edges[index].sourceId))], scoring: { pathLengthMeters: winner.length, totalTurnDegrees: winner.totalTurn, turns: winner.turns, graphCost: winner.cost, endpointGapMeters: winner.gapDistance } })
    const combined = [...components[winner.left], ...winner.edges, ...components[winner.right]]
    components = components.filter((_, index) => index !== winner.left && index !== winner.right)
    components.push(combined); changed = true
  }
  const directSourceIds = [...new Set(seedIndexes.map((index) => network.edges[index].sourceId))]
  const osmIds = [...new Set(seedIndexes.map((index) => network.edges[index].osmId).filter(Boolean))]
  const confidence = inferred.length ? Math.min(...inferred.map((item) => item.confidence)) : 1
  const inferredBySegment = new Map(inferred.flatMap((connection) => connection.inferredPathSegmentIds.map((id) => [id, connection.confidence])))
  const segmentProvenance = [
    ...initialComponents.flatMap((component) => component.map((index) => {
      const edge = network.edges[index]
      return { segmentId: edge.id, sourceId: edge.sourceId, osmId: edge.osmId, method: component.length > 1 ? 'stroke_continuation' : 'direct_source', confidence: 1, inferred: false }
    })),
    ...[...inferredBySegment].map(([segmentId, segmentConfidence]) => {
      const edge = network.edges.find((candidate) => candidate.id === segmentId)
      return { segmentId, sourceId: edge?.sourceId, osmId: edge?.osmId, method: 'graph_gap_completion', confidence: segmentConfidence, inferred: true }
    }),
  ]
  const sourceFeatures = collection.features.filter((feature) => directSourceIds.includes(feature.properties?.id))
  const unique = (values) => [...new Set(values.filter(Boolean))]
  const sourceUrls = unique(sourceFeatures.flatMap((feature) => feature.properties?.source_url ?? []))
  const sources = unique(sourceFeatures.flatMap((feature) => feature.properties?.source ?? []))
  const licenses = unique(sourceFeatures.map((feature) => feature.properties?.license))
  const checkedDates = unique(sourceFeatures.map((feature) => feature.properties?.checked)).sort()
  return {
    type: 'Feature',
    properties: { id: `logical-road-${normalize(targetName)}`, name: targetName, aliases: [], type: 'road', method: inferred.length ? 'graph_gap_completion' : 'stroke_continuation', confidence, directlySourced: inferred.length === 0, source: sources, source_url: sourceUrls, license: licenses.join(', '), checked: checkedDates.at(-1), note: 'Logical road reconstructed from current OSM topology; inferred graph paths are not historical evidence.', sourceSegmentIds: directSourceIds, osmIds, inferredConnections: inferred, segmentProvenance, strokeCount: components.length, sourceGeometry: { type: 'MultiLineString', coordinates: sourceFeatures.map((feature) => feature.geometry.coordinates) }, illustrationWidthScale: 1.8 },
    geometry: { type: 'MultiLineString', coordinates: components.flatMap((component) => linesForComponent(component, network)) },
  }
}

export function processRoadStrokes(collection, targets = ['甲州街道'], options = {}) {
  const features = targets.map((target) => reconstructLogicalRoad(collection, target, options)).filter(Boolean)
  return { type: 'FeatureCollection', features }
}

async function main() {
  const input = process.argv[2] ?? 'public/data/modern/shinjuku-osm.geojson'
  const output = process.argv[3] ?? 'public/data/modern/shinjuku-logical-roads.geojson'
  const collection = JSON.parse(await readFile(input, 'utf8'))
  const logical = processRoadStrokes(collection)
  await writeFile(output, `${JSON.stringify(logical, null, 2)}\n`)
  console.log(`Wrote ${logical.features.length} logical road(s) to ${output}.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
