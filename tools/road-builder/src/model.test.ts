import {describe,expect,it} from 'vitest'
import {applyStatutoryNetworkChoice,canBuild,canConnect,deletionApiPaths,deletionConfirmation,emptyDiagnosticState,emptyManualSelection,emptyRoad,findRegisteredRoad,initialLayerVisibility,previewStageAfterManualEdit,removeAt,resolveDeletableRoad,statutoryNetworkChoice,toggle,toggleLayerVisibility,toggleManualAtom,uniqueAdd} from './model'

describe('road form helpers',()=>{
  it('adds and removes exact OSM names',()=>expect(removeAt(uniqueAdd(['青梅街道'],'Ome Kaido'),0)).toEqual(['Ome Kaido']))
  it('toggles N13 classes without duplicates',()=>expect(toggle(toggle([], '5'),'5')).toEqual([]))
  it('presets statutory OSM network independently of N13 classification',()=>{
    const reference={type:'osm-ref',ref:'20'}
    expect(applyStatutoryNetworkChoice(reference,'national').network).toBe('JP:national')
    expect(applyStatutoryNetworkChoice(reference,'prefectural').network).toBe('JP:prefectural')
    expect(statutoryNetworkChoice('JP:national')).toBe('national')
    expect(statutoryNetworkChoice('JP:custom')).toBe('custom')
  })
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
  it('recognizes a registered current ID independently of dropdown editing state',()=>{
    const registered={...emptyRoad(),id:'tokyo-named-itsukaichi-kaido',displayName:'五日市街道'}
    expect(resolveDeletableRoad([registered],registered.id,registered.id)).toBe(registered)
    expect(resolveDeletableRoad([registered],registered.id,undefined)).toBe(registered)
    expect(findRegisteredRoad([registered],'tokyo-named-unknown')).toBeUndefined()
  })
  it('uses registered identity and name in deletion confirmation, not draft fields',()=>{
    const registered={...emptyRoad(),id:'tokyo-named-itsukaichi-kaido',displayName:'五日市街道'}
    const target=resolveDeletableRoad([registered],registered.id)
    expect(deletionConfirmation(target!,[])).toContain('Delete 五日市街道?\ntokyo-named-itsukaichi-kaido')
    expect(deletionConfirmation(target!,[])).not.toContain('unsaved name')
    expect(deletionApiPaths(target!.id)).toEqual({references:'/api/roads/tokyo-named-itsukaichi-kaido/references',delete:'/api/roads/tokyo-named-itsukaichi-kaido'})
  })
  it('stops exposing deletion after the registered entry is removed',()=>expect(resolveDeletableRoad([], 'tokyo-named-itsukaichi-kaido')).toBeUndefined())
  it('applies reversible manual includes and exclusions without changing the automatic decision',()=>{
    expect(toggleManualAtom(emptyManualSelection(),'auto',true)).toEqual({include:[],exclude:['auto']})
    expect(toggleManualAtom({include:[],exclude:['auto']},'auto',true)).toEqual(emptyManualSelection())
    expect(toggleManualAtom(emptyManualSelection(),'candidate',false)).toEqual({include:['candidate'],exclude:[]})
  })
  it('invalidates only the final preview after a manual edit',()=>{
    expect(previewStageAfterManualEdit('FINAL_READY')).toBe('MATCH_EDITED')
    expect(canConnect('MATCH_EDITED')).toBe(true)
    expect(canBuild('MATCH_EDITED','final')).toBe(false)
    expect(canBuild('FINAL_READY','final')).toBe(true)
  })
})
