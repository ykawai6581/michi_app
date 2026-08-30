import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProject, PROJECT_FILES, resolveProjectId } from './project'

describe('project loading', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('loads the manifest and all five project layer families', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('manifest.json') ? { projectId: 'shinjuku', bounds: [139,35,140,36], featureCounts: {} } : { type: 'FeatureCollection', features: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const project = await loadProject()
    expect(project.manifest.projectId).toBe('shinjuku')
    expect(Object.keys(project.collections)).toEqual([...PROJECT_FILES])
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
  it('keeps mixed searchable entity types from project data', async () => {
    const types = ['road','railway','station','historical-road','historical-place']
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('manifest.json') ? { projectId:'shinjuku', bounds:[139,35,140,36], featureCounts:{} } : { type:'FeatureCollection', features:[{ type:'Feature', properties:{ id:String(index), name:String(index), type:types[index++] }, geometry:{ type:'Point', coordinates:[139,35] } }] } })))
    const project = await loadProject()
    expect(project.searchable.map((feature) => feature.properties.type)).toEqual(['road','station','historical-road','historical-place'])
  })
  it('loads an explicit project ID consistently', async () => {
    const fetchMock = vi.fn(async () => ({ ok:true, json:async()=>({type:'FeatureCollection',features:[]}) }))
    vi.stubGlobal('fetch',fetchMock);await loadProject('koshu-video')
    expect(fetchMock.mock.calls.every((call)=>String((call as unknown[])[0]).includes('/projects/koshu-video/'))).toBe(true)
  })
  it('resolves safe URL IDs and defaults unsafe or missing IDs',()=>{
    expect(resolveProjectId('?project=foo')).toBe('foo')
    expect(resolveProjectId('')).toBe('shinjuku')
    expect(resolveProjectId('?project=../secret')).toBe('shinjuku')
    expect(resolveProjectId('?project=/absolute')).toBe('shinjuku')
  })
  it('rejects an unsafe explicit ID',async()=>{await expect(loadProject('../secret')).rejects.toThrow('Unsafe project ID')})
})
