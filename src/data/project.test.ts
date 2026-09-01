import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProject, PROJECT_FILES, railwaySearchFeatures, resolveProjectId } from './project'

describe('project loading', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('loads the manifest and all project layer families', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('project.json') ? { id: 'shinjuku', displayName: '新宿' } : url.endsWith('manifest.json') ? { projectId: 'shinjuku', bounds: [139,35,140,36], featureCounts: {} } : { type: 'FeatureCollection', features: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const project = await loadProject()
    expect(project.manifest.projectId).toBe('shinjuku')
    expect(project.config).toEqual({ id: 'shinjuku', displayName: '新宿' })
    expect(Object.keys(project.collections)).toEqual([...PROJECT_FILES])
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
  it('keeps mixed searchable entity types from project data', async () => {
    const types = ['road','railway','railway','station','historical-road','historical-place']
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('project.json') ? { id:'shinjuku', displayName:'新宿' } : url.endsWith('manifest.json') ? { projectId:'shinjuku', bounds:[139,35,140,36], featureCounts:{} } : { type:'FeatureCollection', features:[{ type:'Feature', properties:{ id:String(index), name:String(index), type:types[index++] }, geometry:{ type:'Point', coordinates:[139,35] } }] } })))
    const project = await loadProject()
    expect(project.searchable.map((feature) => feature.properties.type)).toEqual(['road','station','historical-road','historical-place','railway'])
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
  it('creates one searchable railway per exact group and excludes unnamed tracks',()=>{
    const line=(id:string,group?:string,name='中央本線')=>({type:'Feature' as const,properties:{id,name,type:'railway',...(group?{railGroupId:group,railDisplayName:name}:{})},geometry:{type:'LineString' as const,coordinates:[[0,0],[1,1]]}})
    const result=railwaySearchFeatures({type:'FeatureCollection',features:[line('1','rail:a'),line('2','rail:a'),line('3','rail:b','別線'),line('4')]})
    expect(result.map(feature=>feature.properties.id)).toEqual(['rail:a','rail:b'])
    expect(result[0].geometry.type).toBe('MultiLineString')
    if(result[0].geometry.type==='MultiLineString')expect(result[0].geometry.coordinates).toHaveLength(2)
  })
})
