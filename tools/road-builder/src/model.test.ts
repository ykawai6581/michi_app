import {describe,expect,it} from 'vitest'
import {applyGapCandidateEdit,applyStatutoryNetworkChoice,atomIdsIntersectingBounds,canBuild,canConnect,candidatePathGeoJson,continuityInspection,continuitySummaryText,deletionApiPaths,deletionConfirmation,deriveAvailableAtomIds,deriveManualReviewLayers,emptyDiagnosticState,emptyManualSelection,emptyRoad,excludeManualAtom,excludeManualAtoms,findRegisteredRoad,gapReviewQueue,includeGapCandidate,includeManualAtom,initialLayerVisibility,isAddableCandidate,mapLayerVisibility,nextReviewGap,previewStageAfterManualEdit,removeAt,resolveDeletableRoad,restoreManualAtom,selectedContinuityCheck,statutoryNetworkChoice,toggle,toggleLayerVisibility,toggleManualAtom,uniqueAdd} from './model'

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
  it('maps every checkbox deterministically to MapLibre visibility and preserves hidden state for new data',()=>{
    const hiddenAuto=toggleLayerVisibility(initialLayerVisibility(),'autoSelected')
    const hiddenShortlist=toggleLayerVisibility(hiddenAuto,'unselectedShortlist')
    expect(mapLayerVisibility(hiddenShortlist,'autoSelected')).toBe('none')
    expect(mapLayerVisibility(hiddenShortlist,'unselectedShortlist')).toBe('none')
    expect(mapLayerVisibility(toggleLayerVisibility(hiddenShortlist,'reference'),'reference')).toBe('none')
    expect(mapLayerVisibility(hiddenShortlist,'autoSelected',true)).toBe('none')
    expect(mapLayerVisibility(initialLayerVisibility(),'autoSelected',false)).toBe('none')
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
  it('reviews only unresolved non-ignored continuity gaps',()=>{
    const gap=(gapId:string,decision:string)=>({gapId,decision,gapKind:'topology-gap',referencePart:0,referenceGapMeters:0,geometryGapMeters:5,upstreamN13AtomId:'a',downstreamN13AtomId:'b',candidatePathCount:0,candidatePaths:[]})
    expect(gapReviewQueue([gap('auto','accepted-auto-connector'),gap('one','unresolved-no-path'),gap('two','unresolved-ambiguous')],new Set(['one'])).map(item=>item.gapId)).toEqual(['two'])
  })
  it('selects resolved and unresolved checks independently of the review queue',()=>{
    const check=(gapId:string,decision:string)=>({gapId,decision,gapKind:'topology-gap',referencePart:0,referenceGapMeters:0,geometryGapMeters:5,upstreamN13AtomId:'a',downstreamN13AtomId:'b',candidatePathCount:0,candidatePaths:[]})
    const checks=[check('resolved','accepted-auto-connector'),check('gap','unresolved-no-path')]
    expect(selectedContinuityCheck(checks,'resolved')?.decision).toBe('accepted-auto-connector')
    expect(gapReviewQueue(checks,new Set()).map(item=>item.gapId)).toEqual(['gap'])
    expect(initialLayerVisibility()).toMatchObject({continuityGaps:true,continuityChecks:false})
    const resolved=continuityInspection(checks,[checks[1]],'resolved',new Set())
    expect(resolved).toMatchObject({check:checks[0],unresolved:undefined,showCandidateActions:false,queueIndex:-1})
    const unresolved=continuityInspection(checks,[checks[1]],'gap',new Set())
    expect(unresolved).toMatchObject({check:checks[1],unresolved:checks[1],showCandidateActions:true,queueIndex:0})
    expect(continuitySummaryText({checkedCount:2,autoResolvedCount:1,unresolvedCount:1,topologyCheckedCount:2,referenceCheckedCount:0,autoResolvedTopologyCount:1}))
      .toBe('2 transitions checked · 1 connected / auto repaired · 1 unresolved')
  })
  it('adds one or two gap atoms atomically and removes exclusions',()=>{
    expect(includeGapCandidate({include:[],exclude:['a','keep']},{atomIds:['a']})).toEqual({include:['a'],exclude:['keep']})
    expect(includeGapCandidate({include:[],exclude:['a','b']},{atomIds:['a','b']})).toEqual({include:['a','b'],exclude:[]})
    const unchanged={include:['existing'],exclude:[]}
    expect(includeGapCandidate(unchanged,{atomIds:[]})).toBe(unchanged)
    expect(isAddableCandidate({atomIds:[]})).toBe(false)
  })
  it('removes handled and ignored gaps and advances through the remaining snapshot',()=>{
    const gap=(gapId:string)=>({gapId,decision:'unresolved-no-path',gapKind:'topology-gap',referencePart:0,referenceGapMeters:0,geometryGapMeters:5,upstreamN13AtomId:'a',downstreamN13AtomId:'b',candidatePathCount:0,candidatePaths:[]})
    const gaps=[gap('one'),gap('two'),gap('three')],handled=new Set(['one']),ignored=new Set(['two'])
    expect(gapReviewQueue(gaps,ignored,handled).map(item=>item.gapId)).toEqual(['three'])
    expect(nextReviewGap(gaps,'one',new Set(),handled)?.gapId).toBe('two')
    expect(nextReviewGap(gaps,'two',ignored,handled)?.gapId).toBe('three')
    expect(gaps).toHaveLength(3)
    const edit=applyGapCandidateEdit({include:[],exclude:['atom']},{atomIds:['atom']},gaps,'one',new Set(),new Set())!
    expect(edit).toMatchObject({manualSelection:{include:['atom'],exclude:[]},nextGapId:'two',finalPreviewId:undefined,stage:'MATCH_EDITED'})
    expect([...edit.handledGapIds]).toEqual(['one'])
    expect(applyGapCandidateEdit(emptyManualSelection(),{atomIds:[]},gaps,'one',new Set(),new Set())).toBeUndefined()
  })
  it('derives candidate highlighting from stable source atom IDs',()=>{
    const source={features:[{properties:{n13AtomId:'a'},geometry:null},{properties:{n13AtomId:'b'},geometry:null},{properties:{n13AtomId:'c'},geometry:null}]}
    expect(candidatePathGeoJson(source,{atomIds:['a','c']}).features.map(feature=>feature.properties?.n13AtomId)).toEqual(['a','c'])
  })
  it('region selection uses inclusive line/rectangle intersection for every shortlisted atom',()=>{
    const feature=(id:string,coordinates:number[][],automaticSelection=false)=>({type:'Feature',properties:{n13AtomId:id,automaticSelection},geometry:{type:'LineString' as const,coordinates}})
    const candidates={features:[
      feature('inside',[[1,1],[2,2]],true),
      feature('crosses',[[-1,2],[5,2]]),
      feature('touches',[[-1,0],[0,0]]),
      feature('outside',[[-2,-2],[-1,-1]]),
    ]}
    expect(atomIdsIntersectingBounds(candidates,[0,0,4,4])).toEqual(['inside','crosses','touches'])
  })
  it('a region exclusion wins over a previous manual include as one atomic state update',()=>{
    expect(excludeManualAtoms({include:['crosses','safe'],exclude:['old']},['crosses','new']))
      .toEqual({include:['safe'],exclude:['old','crosses','new']})
  })
  it('manual atom helpers keep include and exclude mutually exclusive',()=>{
    const included=includeManualAtom({include:[],exclude:['atom']},'atom')
    expect(included).toEqual({include:['atom'],exclude:[]})
    const excluded=excludeManualAtom(included,'atom')
    expect(excluded).toEqual({include:[],exclude:['atom']})
    expect(restoreManualAtom(excluded,'atom')).toEqual(emptyManualSelection())
  })
  it('click transitions restore automatic and non-automatic atoms to their baselines',()=>{
    const automaticExcluded=toggleManualAtom(emptyManualSelection(),'auto',true)
    expect(automaticExcluded).toEqual({include:[],exclude:['auto']})
    expect(toggleManualAtom(automaticExcluded,'auto',true)).toEqual(emptyManualSelection())
    const availableIncluded=toggleManualAtom(emptyManualSelection(),'available',false)
    expect(availableIncluded).toEqual({include:['available'],exclude:[]})
    expect(toggleManualAtom(availableIncluded,'available',false)).toEqual(emptyManualSelection())
    expect(toggleManualAtom({include:[],exclude:['available']},'available',false)).toEqual(emptyManualSelection())
  })
  it('promotes an included automatic substring to its complete source atom in review layers',()=>{
    const feature=(id:string,coordinates:number[][])=>({properties:{n13AtomId:id,automaticSelection:true},geometry:{type:'LineString' as const,coordinates}})
    const source={autoSelected:{features:[feature('auto',[[2,0],[4,0]])]},
      autoSelectedSourceAtoms:{features:[feature('auto',[[0,0],[10,0]])]},
      sourceAtoms:{features:[feature('auto',[[0,0],[10,0]])]},sourceAdjacency:{auto:[]}}
    const baseline=deriveManualReviewLayers(source,emptyManualSelection())
    expect(baseline.autoSelected.features[0].geometry?.coordinates).toEqual([[2,0],[4,0]])
    const promoted=deriveManualReviewLayers(source,{include:['auto'],exclude:[]})
    expect(promoted.autoSelected.features).toEqual([])
    expect(promoted.manuallyIncluded.features[0].geometry?.coordinates).toEqual([[0,0],[10,0]])
  })
  it('exposes only a frontier-relevant, non-overlapping remainder of a partial automatic atom',()=>{
    const feature=(id:string,coordinates:number[][],automaticSelection=true)=>({properties:{n13AtomId:id,automaticSelection},geometry:{type:'LineString' as const,coordinates}})
    const partial=feature('A',[[0,0],[30,0]])
    const source={autoSelected:{features:[partial]},autoSelectedSourceAtoms:{features:[feature('A',[[0,0],[100,0]])]},
      sourceAtoms:{features:[feature('A',[[0,0],[100,0]]),feature('B',[[100,0],[110,0]],false)]},sourceAdjacency:{A:['B'],B:['A']}}

    const frontier=deriveManualReviewLayers(source,{include:['B'],exclude:[]})
    const remainder=frontier.unselectedShortlist.features.find(item=>item.properties?.promotionRemainder)
    expect(remainder?.properties).toMatchObject({n13AtomId:'A',automaticSelection:false,selectionReason:'promotion-remainder'})
    expect(remainder?.geometry?.coordinates).toEqual([[30,0],[100,0]])
    expect(frontier.autoSelected.features[0].geometry?.coordinates).toEqual([[0,0],[30,0]])

    const promotedSelection=toggleManualAtom({include:['B'],exclude:[]},'A',Boolean(remainder?.properties?.automaticSelection))
    expect(promotedSelection.include).toEqual(['B','A'])
    const promoted=deriveManualReviewLayers(source,promotedSelection)
    expect(promoted.autoSelected.features).toEqual([])
    expect(promoted.unselectedShortlist.features.some(item=>item.properties?.n13AtomId==='A')).toBe(false)
    expect(promoted.manuallyIncluded.features.filter(item=>item.properties?.n13AtomId==='A')).toHaveLength(1)
    expect(promoted.manuallyIncluded.features.find(item=>item.properties?.n13AtomId==='A')?.geometry?.coordinates).toEqual([[0,0],[100,0]])

    const restored=deriveManualReviewLayers(source,toggleManualAtom(promotedSelection,'A',false))
    expect(restored.autoSelected.features[0].geometry?.coordinates).toEqual([[0,0],[30,0]])
    expect(restored.unselectedShortlist.features.find(item=>item.properties?.promotionRemainder)?.geometry?.coordinates).toEqual([[30,0],[100,0]])
  })
  it('does not expose a partial automatic remainder away from the current frontier',()=>{
    const feature=(id:string,coordinates:number[][],automaticSelection=true)=>({properties:{n13AtomId:id,automaticSelection},geometry:{type:'LineString' as const,coordinates}})
    const source={autoSelected:{features:[feature('A',[[0,0],[30,0]])]},autoSelectedSourceAtoms:{features:[feature('A',[[0,0],[100,0]])]},
      sourceAtoms:{features:[feature('A',[[0,0],[100,0]]),feature('B',[[200,0],[210,0]],false)]},sourceAdjacency:{A:[],B:[]}}
    const review=deriveManualReviewLayers(source,{include:['B'],exclude:[]})
    expect(review.unselectedShortlist.features.some(item=>item.properties?.promotionRemainder)).toBe(false)
  })
  it('derives mutually disjoint review layers and restores automatic placement on undo',()=>{
    const feature=(id:string,automaticSelection:boolean)=>({properties:{n13AtomId:id,automaticSelection},geometry:{type:'LineString' as const,coordinates:[[0,0],[1,1]]}})
    const source={autoSelected:{features:[feature('auto',true)]},autoSelectedSourceAtoms:{features:[feature('auto',true)]},sourceAtoms:{features:[feature('auto',true),feature('alternative',false)]},sourceAdjacency:{auto:['alternative'],alternative:['auto']}}
    const edited=deriveManualReviewLayers(source,{include:['alternative'],exclude:['auto']})
    expect(edited.autoSelected.features).toEqual([])
    expect(edited.unselectedShortlist.features).toEqual([])
    expect(edited.manuallyIncluded.features.map(item=>item.properties?.n13AtomId)).toEqual(['alternative'])
    expect(edited.manuallyExcluded.features.map(item=>item.properties?.n13AtomId)).toEqual(['auto'])
    expect(edited.manuallyIncluded.features[0].properties?.selectionReason).toBe('accepted-manual')
    expect(edited.manuallyExcluded.features[0].properties?.selectionReason).toBe('rejected-manual')
    const restored=deriveManualReviewLayers(source,emptyManualSelection())
    expect(restored.autoSelected.features.map(item=>item.properties?.n13AtomId)).toEqual(['auto'])
    expect(restored.unselectedShortlist.features.map(item=>item.properties?.n13AtomId)).toEqual(['alternative'])
  })
  it('derives an expanding frontier from selected atoms and treats exclusion as a barrier',()=>{
    const graph={A:['B'],B:['A','C'],C:['B']}
    expect(deriveAvailableAtomIds(['A'],graph,emptyManualSelection())).toEqual(['B'])
    expect(deriveAvailableAtomIds(['A'],graph,{include:['B'],exclude:[]})).toEqual(['C'])
    expect(deriveAvailableAtomIds(['A'],graph,restoreManualAtom({include:['B'],exclude:[]},'B'))).toEqual(['B'])
    expect(deriveAvailableAtomIds(['A'],graph,{include:[],exclude:['B']})).toEqual([])
  })
})
