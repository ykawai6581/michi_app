// @ts-expect-error Vitest executes this regression in Node; the browser bundle has no Node types.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { buildLogicalRoadEntities, generateCoinsStrokes } from './coins'

const origin = [139.7, 35.69]
const point = (x: number, y: number): [number, number] => [origin[0] + x / 90_000, origin[1] + y / 110_540]
const road = (id: string, coordinates: [number, number][], properties: Partial<EntityFeature['properties']> = {}): EntityFeature => ({ type: 'Feature', properties: { id, name: '甲州街道', type: 'road', highway: 'primary', osm_id: Number(id.replace(/\D/g, '')) || undefined, ...properties }, geometry: { type: 'LineString', coordinates } })

const strokeSizes = (features: EntityFeature[]) => generateCoinsStrokes(features).strokes.map((stroke) => stroke.length).sort((a, b) => b - a)

describe('COINS every-best-fit strokes', () => {
  it('joins a straight continuation through mutual endpoint best fits', () => {
    const features = [road('1', [point(0, 0), point(50, 0)]), road('2', [point(50, 0), point(100, 0)])]
    const result = generateCoinsStrokes(features)
    expect(result.strokes.map((stroke) => stroke.length)).toEqual([2])
    expect(result.debug[0].endpoint2).toMatchObject({ best: 1, mutualLink: 1 })
    expect(result.debug[1].endpoint1).toMatchObject({ best: 0, mutualLink: 0 })
  })

  it('joins a gentle bend above the continuation threshold', () => expect(strokeSizes([
    road('1', [point(0, 0), point(50, 0)]), road('2', [point(50, 0), point(100, 15)]),
  ])).toEqual([2]))

  it('keeps the straight pair together at a T junction', () => expect(strokeSizes([
    road('1', [point(0, 0), point(50, 0)]), road('2', [point(50, 0), point(100, 0)]), road('3', [point(50, 0), point(50, 50)]),
  ])).toEqual([2, 1]))

  it('forms the two perceptually continuous strokes at a crossing', () => expect(strokeSizes([
    road('1', [point(0, 0), point(50, 0)]), road('2', [point(50, 0), point(100, 0)]),
    road('3', [point(50, -50), point(50, 0)]), road('4', [point(50, 0), point(50, 50)]),
  ])).toEqual([2, 2]))

  it('leaves a geometrically and thematically tied fork ambiguous', () => {
    const result = generateCoinsStrokes([
      road('1', [point(0, 0), point(50, 0)]), road('2', [point(50, 0), point(100, 35)]), road('3', [point(50, 0), point(100, -35)]),
    ])
    expect(result.strokes).toHaveLength(3)
    expect(result.debug.find(({ segmentId }) => segmentId === '1:0')?.endpoint2.rejectedReason).toBe('ambiguous')
  })

  it('does not connect nearby parallel roads without shared topology', () => expect(strokeSizes([
    road('1', [point(0, 0), point(100, 0)]), road('2', [point(0, 8), point(100, 8)]),
  ])).toEqual([1, 1]))

  it('carries unnamed and ref-only segments through one geometric stroke', () => {
    const features = [
      road('1', [point(0, 0), point(40, 0)]),
      road('2', [point(40, 0), point(80, 0)], { name: '' }),
      road('3', [point(80, 0), point(120, 0)], { name: '', ref: '20' }),
      road('4', [point(120, 0), point(160, 0)]),
    ]
    const logical = buildLogicalRoadEntities(features, ['甲州街道'])[0]
    expect(logical.properties.sourceSegmentIds).toEqual(['1', '2', '3', '4'])
    expect(logical.properties.segmentProvenance?.filter(({ inferred }) => inferred)).toHaveLength(2)
    expect(logical.properties.coinsDiagnostics?.networkCoverage).toBe('corridor')
  })

  it('uses thematic attributes only to break an exact geometric tie', () => {
    const result = generateCoinsStrokes([
      road('1', [point(0, 0), point(50, 0)], { highway: 'primary' }),
      road('2', [point(50, 0), point(100, 35)], { highway: 'primary' }),
      road('3', [point(50, 0), point(100, -35)], { highway: 'service' }),
    ])
    expect(result.debug.find(({ segmentId }) => segmentId === '1:0')?.endpoint2.best).toBe(1)
  })
})

describe('current Shinjuku road network', () => {
  it('reports real-data continuity for Kōshū Kaidō and Shinjuku-dōri', async () => {
    const collection = JSON.parse(await readFile('public/data/modern/shinjuku-osm.geojson', 'utf8')) as { features: EntityFeature[] }
    const roads = collection.features.filter(({ properties }) => properties.type === 'road')
    const logical = buildLogicalRoadEntities(roads, ['甲州街道', '新宿通り'])
    expect(logical.map(({ properties }) => properties.name)).toEqual(['甲州街道', '新宿通り'])
    expect(logical.every(({ properties }) => properties.aliases?.length === 0)).toBe(true)
    expect(logical.every(({ properties }) => (properties.sourceSegmentIds?.length ?? 0) > 0)).toBe(true)
    expect(logical.every(({ properties }) => (properties.coinsDebug?.length ?? 0) > 0)).toBe(true)
    expect(logical.every(({ properties }) => properties.coinsDiagnostics !== undefined)).toBe(true)
    logical.forEach((feature) => {
      const exactSourceCount = roads.filter(({ properties }) => properties.name === feature.properties.name).length
      expect(feature.properties.sourceSegmentIds?.length).toBeGreaterThan(exactSourceCount)
    })
  })
})
