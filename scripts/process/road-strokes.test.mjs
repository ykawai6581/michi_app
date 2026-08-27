import { describe, expect, it } from 'vitest'
import { buildRoadNetwork, continuationScore, processRoadStrokes, reconstructLogicalRoad } from './road-strokes.mjs'

const road = (id, coordinates, properties = {}) => ({ type: 'Feature', properties: { id, osm_id: id, name: '甲州街道', type: 'road', highway: 'primary', ...properties }, geometry: { type: 'LineString', coordinates } })
const station = { type: 'Feature', properties: { id: 'station', name: '新宿', type: 'station' }, geometry: { type: 'Point', coordinates: [139.7, 35.69] } }
const collection = (...features) => ({ type: 'FeatureCollection', features })

const base = [139.7, 35.69]
const point = (x, y) => [base[0] + x / 90_000, base[1] + y / 110_540]

describe('road stroke topology', () => {
  it('groups a straight adjacent chain into one stroke', () => {
    const result = reconstructLogicalRoad(collection(road('a', [point(0, 0), point(50, 0)]), road('b', [point(50, 0), point(100, 0)])), '甲州街道')
    expect(result.properties.strokeCount).toBe(1)
  })

  it('continues through a slight bend', () => {
    const result = reconstructLogicalRoad(collection(road('a', [point(0, 0), point(50, 0)]), road('b', [point(50, 0), point(100, 12)])), '甲州街道')
    expect(result.properties.strokeCount).toBe(1)
  })

  it('prefers the straight continuation at a T-junction', () => {
    const result = reconstructLogicalRoad(collection(road('west', [point(0, 0), point(50, 0)]), road('east', [point(50, 0), point(100, 0)]), road('side', [point(50, 0), point(50, 50)])), '甲州街道')
    expect(result.properties.strokeCount).toBe(2)
  })

  it('rejects a sharply turning side road', () => {
    const result = reconstructLogicalRoad(collection(road('main', [point(0, 0), point(50, 0)]), road('side', [point(50, 0), point(55, 50)])), '甲州街道')
    expect(result.properties.strokeCount).toBe(2)
  })

  it('gives compatible name and ref a higher continuation score', () => {
    const network = buildRoadNetwork(collection(
      road('incoming', [point(0, 0), point(50, 0)], { ref: '20' }),
      road('matching', [point(50, 0), point(100, 10)], { ref: '20' }),
      road('other', [point(50, 0), point(100, -10)], { name: '別の道', ref: '99' }),
    ))
    const [incoming, matching, other] = network.edges
    expect(continuationScore(incoming, matching, incoming.b).score).toBeGreaterThan(continuationScore(incoming, other, incoming.b).score)
  })

  it('recovers a short semantic gap through existing graph geometry', () => {
    const result = reconstructLogicalRoad(collection(
      road('left', [point(0, 0), point(50, 0)]),
      road('gap', [point(50, 0), point(90, 0)], { name: '接続道路', ref: '' }),
      road('right', [point(90, 0), point(140, 0)]),
    ), '甲州街道')
    expect(result.properties.inferredConnections).toHaveLength(1)
    expect(result.properties.inferredConnections[0]).toMatchObject({ method: 'graph_gap_completion', inferredSourceIds: ['gap'] })
    expect(result.properties.confidence).toBeGreaterThanOrEqual(0.72)
  })

  it('leaves a large gap disconnected', () => {
    const result = reconstructLogicalRoad(collection(road('left', [point(0, 0), point(50, 0)]), road('right', [point(500, 0), point(550, 0)])), '甲州街道')
    expect(result.properties.strokeCount).toBe(2)
    expect(result.properties.inferredConnections).toEqual([])
  })

  it('leaves equally plausible graph paths ambiguous and disconnected', () => {
    const result = reconstructLogicalRoad(collection(
      road('left', [point(0, 0), point(40, 0)]),
      road('upper-a', [point(40, 0), point(70, 15)], { name: '接続道路' }),
      road('upper-b', [point(70, 15), point(100, 0)], { name: '接続道路' }),
      road('lower-a', [point(40, 0), point(70, -15)], { name: '接続道路' }),
      road('lower-b', [point(70, -15), point(100, 0)], { name: '接続道路' }),
      road('right', [point(100, 0), point(140, 0)]),
    ), '甲州街道')
    expect(result.properties.inferredConnections).toEqual([])
    expect(result.properties.strokeCount).toBe(2)
  })

  it('does not snap nearby parallel carriageways together', () => {
    const network = buildRoadNetwork(collection(road('one', [point(0, 0), point(100, 0)]), road('two', [point(0, 8), point(100, 8)])))
    expect(network.nodes).toHaveLength(4)
    expect(reconstructLogicalRoad(collection(road('one', [point(0, 0), point(100, 0)]), road('two', [point(0, 8), point(100, 8)])), '甲州街道').properties.strokeCount).toBe(2)
  })

  it('does not include non-road entities in logical road output', () => {
    const result = processRoadStrokes(collection(road('road', [point(0, 0), point(50, 0)]), station))
    expect(result.features).toHaveLength(1)
    expect(station.properties).toMatchObject({ type: 'station', name: '新宿' })
  })

  it('uses only the exact Kōshū Kaidō name as a seed, never aliases or refs', () => {
    const result = reconstructLogicalRoad(collection(
      road('seed', [point(0, 0), point(50, 0)]),
      road('alias-only', [point(50, 0), point(100, 0)], { name: '新宿通り', ref: '20', aliases: ['甲州街道'] }),
    ), '甲州街道')
    expect(result.properties.sourceSegmentIds).toEqual(['seed'])
    expect(result.properties.aliases).toEqual([])
  })
})

describe('current Shinjuku extract', () => {
  it('reconstructs only exact-name Kōshū Kaidō seeds and retains their OSM provenance', async () => {
    const { readFile } = await import('node:fs/promises')
    const shinjuku = JSON.parse(await readFile('public/data/modern/shinjuku-osm.geojson', 'utf8'))
    const result = reconstructLogicalRoad(shinjuku, '甲州街道')
    expect(result.properties.aliases).toEqual([])
    expect(result.properties.sourceSegmentIds.length).toBeGreaterThan(0)
    expect(result.properties.osmIds.length).toBeGreaterThan(0)
    expect(result.properties.segmentProvenance.every(({ sourceId }) => sourceId?.startsWith('osm-way-'))).toBe(true)
  })
})
