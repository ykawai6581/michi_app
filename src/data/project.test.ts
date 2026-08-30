import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProject, PROJECT_FILES } from './project'

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
})
