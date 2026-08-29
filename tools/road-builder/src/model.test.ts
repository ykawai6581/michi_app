import {describe,expect,it} from 'vitest'
import {emptyDiagnosticState,initialLayerVisibility,removeAt,toggle,toggleLayerVisibility,uniqueAdd} from './model'

describe('road form helpers',()=>{
  it('adds and removes exact OSM names',()=>expect(removeAt(uniqueAdd(['青梅街道'],'Ome Kaido'),0)).toEqual(['Ome Kaido']))
  it('toggles N13 classes without duplicates',()=>expect(toggle(toggle([], '5'),'5')).toEqual([]))
  it('toggles layer visibility without touching its data',()=>{
    const data={type:'FeatureCollection',features:[]} as const
    const layers={reference:data}
    const hidden=toggleLayerVisibility(initialLayerVisibility(),'reference')
    expect(hidden.reference).toBe(false)
    expect(layers.reference).toBe(data)
    expect(toggleLayerVisibility(hidden,'reference').reference).toBe(true)
  })
  it('models New road diagnostics as independently clearable state',()=>{
    const cleared=emptyDiagnosticState()
    expect(cleared).toEqual({layers:{},analysis:undefined,discovered:[],picked:{}})
  })
})
