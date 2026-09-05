import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { canonicalRailwayRoutes, loadProject, PROJECT_FILES, railwaySearchFeatures, resolveProjectId } from './project'

const line = (id: string, properties: Partial<EntityFeature['properties']> = {}, coordinates = [[0, 0], [1, 1]]): EntityFeature => ({
  type: 'Feature', properties: { id, name: '新宿線', type: 'railway', railRouteId: id, ...properties }, geometry: { type: 'LineString', coordinates },
})

describe('project loading', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('loads the manifest and all project layer families', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('project.json') ? { id: 'shinjuku', displayName: '新宿' } : url.endsWith('manifest.json') ? { projectId: 'shinjuku', bounds: [139,35,140,36], featureCounts: {} } : { type: 'FeatureCollection', features: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const project = await loadProject()
    expect(project.manifest.projectId).toBe('shinjuku')
    expect(project.config).toEqual({ id: 'shinjuku', displayName: '新宿' })
    expect(Object.keys(project.collections)).toEqual([...PROJECT_FILES])
    expect(fetchMock).toHaveBeenCalledTimes(9)
  })
  it('keeps mixed searchable entity types from project data', async () => {
    const types = ['road','railway','railway','station','historical-road','historical-place','place']
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('project.json') ? { id:'shinjuku', displayName:'新宿' } : url.endsWith('manifest.json') ? { projectId:'shinjuku', bounds:[139,35,140,36], featureCounts:{} } : { type:'FeatureCollection', features:[{ type:'Feature', properties:{ id:String(index), name:String(index), type:types[index++] }, geometry:{ type:'Point', coordinates:[139,35] } }] } })))
    const project = await loadProject()
    expect(project.searchable.map((feature) => feature.properties.type)).toEqual(['road','station','historical-road','historical-place','place','railway'])
  })
  it('loads an explicit project ID consistently', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok:true, json:async()=>url.endsWith('project.json') ? { id:'koshu-video', displayName:'甲州ビデオ' } : url.endsWith('manifest.json') ? { projectId:'koshu-video', bounds:[0,0,1,1], featureCounts:{} } : {type:'FeatureCollection',features:[]} }))
    vi.stubGlobal('fetch',fetchMock);const project=await loadProject('koshu-video')
    expect(project.config).toEqual({ id:'koshu-video', displayName:'甲州ビデオ' })
    expect(fetchMock.mock.calls.every((call)=>String((call as unknown[])[0]).includes('/projects/koshu-video/'))).toBe(true)
  })
  it('resolves safe URL IDs and defaults unsafe or missing IDs',()=>{
    expect(resolveProjectId('?project=foo')).toBe('foo')
    expect(resolveProjectId('')).toBe('shinjuku')
    expect(resolveProjectId('?project=../secret')).toBe('shinjuku')
    expect(resolveProjectId('?project=/absolute')).toBe('shinjuku')
  })
  it('rejects an unsafe explicit ID',async()=>{await expect(loadProject('../secret')).rejects.toThrow('Unsafe project ID')})
  it('merges route relations sharing Wikidata and preserves provenance and geometry', () => {
    const result = canonicalRailwayRoutes([line('A', { wikidata: 'Q123', name: '山手線' }), line('B', { wikidata: 'Q123', name: '山手線' }, [[2, 2], [3, 3]])])
    expect(result).toHaveLength(1)
    expect(result[0].properties).toMatchObject({ id: 'railway:wikidata:Q123', railCanonicalId: 'wikidata:Q123', railRouteIds: ['A', 'B'] })
    expect(result[0].geometry).toMatchObject({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] })
  })
  it('uses catalog identity only when Wikidata is absent', () => {
    expect(canonicalRailwayRoutes([line('A', { railColorId: 'jr-yamanote' }), line('B', { railColorId: 'jr-yamanote' })])).toHaveLength(1)
    const distinct = canonicalRailwayRoutes([line('A', { wikidata: 'Q1', railColorId: 'same-color-id' }), line('B', { wikidata: 'Q2', railColorId: 'same-color-id' })])
    expect(distinct.map(({ properties }) => properties.id)).toEqual(['railway:wikidata:Q1', 'railway:wikidata:Q2'])
  })
  it('never merges route relations by name alone', () => {
    expect(canonicalRailwayRoutes([line('A'), line('B')]).map(({ properties }) => properties.id)).toEqual(['railway:route:A', 'railway:route:B'])
  })
  it('uses the canonical catalog display name while retaining OSM names as aliases', () => {
    const [result] = canonicalRailwayRoutes([line('A', { name: '京王電鉄井の頭線', railColorId: 'keio-inokashira', railDisplayName: '井の頭線' })])
    expect(result.properties.name).toBe('井の頭線')
    expect(result.properties.aliases).toContain('京王電鉄井の頭線')
  })
  it('keeps physical tracks on the map but only promotes grouped catalog orphans', () => {
    const member = line('way-member', { railRouteId: undefined, railRouteIds: ['route-A'], railColorId: 'keio-keio', name: '京王電鉄京王線' })
    const platform = line('platform', { railRouteId: undefined, name: '京王電鉄京王線;飛田給;1番線' })
    const structure = line('structure', { railRouteId: undefined, name: '山手線;新宿大ガード' })
    const orphanA = line('orphan-a', { railRouteId: undefined, railColorId: 'orphan', railDisplayName: '既知線' })
    const orphanB = line('orphan-b', { railRouteId: undefined, railColorId: 'orphan', railDisplayName: '既知線' }, [[2, 2], [3, 3]])
    const collection = { type: 'FeatureCollection' as const, features: [member, platform, structure, orphanA, orphanB] }
    expect(collection.features).toHaveLength(5)
    expect(railwaySearchFeatures(collection).map(({ properties }) => properties.id)).toEqual(['railway:catalog:orphan'])
    expect(railwaySearchFeatures(collection, [line('route-A', { railColorId: 'orphan' })])).toHaveLength(0)
  })
})
