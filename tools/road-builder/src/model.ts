export type ManualSelection={include:string[];exclude:string[]}
export type Road={id:string;displayName:string;entityType:'named-road'|'statutory-road';presentationType:'road'|'historical-road';jurisdiction:string;aliases:string[];reference:{type:string;names?:string[];tags?:string[];ref?:string;network?:string;excludeNames?:string[];excludeNameTags?:string[];[key:string]:unknown};n13:{classifications:string[]};matching:Record<string,number>;networkSelection?:Record<string,number>;manualSelection?:ManualSelection;manualSelectionN13Fingerprint?:string;[key:string]:unknown}
export const emptyRoad=():Road=>({id:'',displayName:'',entityType:'named-road',presentationType:'road',jurisdiction:'Tokyo',aliases:[],reference:{type:'osm-name',names:[],tags:['name','name:ja','name:en','alt_name']},n13:{classifications:[]},matching:{sampleIntervalMeters:5,maximumMedianResidualMeters:20,maximumP90ResidualMeters:25,coverageToleranceMeters:25}})
export const uniqueAdd=(values:string[],value:string)=>value.trim()&&!values.includes(value.trim())?[...values,value.trim()]:values
export const removeAt=(values:string[],index:number)=>values.filter((_,i)=>i!==index)
export const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(v=>v!==value):[...values,value]
export type StatutoryNetworkChoice='national'|'prefectural'|'custom'
export const statutoryNetworkChoice=(network?:string):StatutoryNetworkChoice=>network==='JP:national'?'national':network==='JP:prefectural'?'prefectural':'custom'
export const applyStatutoryNetworkChoice=(reference:Road['reference'],choice:StatutoryNetworkChoice):Road['reference']=>({...reference,network:choice==='national'?'JP:national':choice==='prefectural'?'JP:prefectural':reference.network||''})

export const diagnosticLayerIds=['allCandidates','residualRejected','autoSelectedSourceAtoms','referenceExcluded','reference','ownership','autoSelected','unselectedShortlist','manuallyIncluded','manuallyExcluded','finalConnected','continuityChecks','continuityGaps','candidateHighlight'] as const
export type DiagnosticLayerId=typeof diagnosticLayerIds[number]
export type LayerVisibility=Record<DiagnosticLayerId,boolean>
export const initialLayerVisibility=():LayerVisibility=>({reference:true,referenceExcluded:false,ownership:true,autoSelected:true,autoSelectedSourceAtoms:false,unselectedShortlist:true,manuallyIncluded:true,manuallyExcluded:false,finalConnected:true,continuityChecks:false,continuityGaps:true,candidateHighlight:true,allCandidates:false,residualRejected:false})
export const toggleLayerVisibility=(visibility:LayerVisibility,id:DiagnosticLayerId):LayerVisibility=>({...visibility,[id]:!visibility[id]})
export const mapLayerVisibility=(visibility:LayerVisibility,id:DiagnosticLayerId,hasData=true):'visible'|'none'=>hasData&&visibility[id]?'visible':'none'
export const emptyDiagnosticState=()=>({layers:{},analysis:undefined,discovered:[] as string[],picked:{}})

export type PreviewStage='NO_MATCH'|'MATCH_RUNNING'|'MATCH_READY'|'MATCH_EDITED'|'CONNECT_RUNNING'|'FINAL_READY'
export const emptyManualSelection=():ManualSelection=>({include:[],exclude:[]})
export const restoreManualAtom=(selection:ManualSelection,atomId:string):ManualSelection=>({
  include:selection.include.filter(id=>id!==atomId),exclude:selection.exclude.filter(id=>id!==atomId)})
export const includeManualAtom=(selection:ManualSelection,atomId:string):ManualSelection=>({
  include:selection.include.includes(atomId)?selection.include:[...selection.include,atomId],
  exclude:selection.exclude.filter(id=>id!==atomId)})
export const excludeManualAtom=(selection:ManualSelection,atomId:string):ManualSelection=>({
  include:selection.include.filter(id=>id!==atomId),
  exclude:selection.exclude.includes(atomId)?selection.exclude:[...selection.exclude,atomId]})
export const toggleManualAtom=(selection:ManualSelection,atomId:string,automatic:boolean):ManualSelection=>{
  if(selection.exclude.includes(atomId)||selection.include.includes(atomId))return restoreManualAtom(selection,atomId)
  return automatic?excludeManualAtom(selection,atomId):includeManualAtom(selection,atomId)
}
export type SelectionBounds=[number,number,number,number]
type LineGeometry={type:'LineString'|'MultiLineString';coordinates:unknown}
type AtomFeature={properties?:Record<string,unknown>|null;geometry?:LineGeometry|null}
type AtomCollection={features:AtomFeature[]}
type Position=[number,number]
const pointInBounds=([x,y]:[number,number],[west,south,east,north]:SelectionBounds)=>x>=west&&x<=east&&y>=south&&y<=north
const segmentIntersectsBounds=(a:[number,number],b:[number,number],bounds:SelectionBounds)=>{
  if(pointInBounds(a,bounds)||pointInBounds(b,bounds))return true
  const[west,south,east,north]=bounds,dx=b[0]-a[0],dy=b[1]-a[1]
  let low=0,high=1
  for(const[p,q]of[[-dx,a[0]-west],[dx,east-a[0]],[-dy,a[1]-south],[dy,north-a[1]]] as [number,number][]){
    if(p===0){if(q<0)return false;continue}
    const ratio=q/p
    if(p<0){if(ratio>high)return false;low=Math.max(low,ratio)}else{if(ratio<low)return false;high=Math.min(high,ratio)}
  }
  return low<=high
}
const lineIntersectsBounds=(coordinates:unknown,bounds:SelectionBounds)=>Array.isArray(coordinates)&&coordinates.some((value,index)=>index>0&&segmentIntersectsBounds(coordinates[index-1] as [number,number],value as [number,number],bounds))
export const atomIdsIntersectingBounds=(collection:AtomCollection,bounds:SelectionBounds):string[]=>{
  const normalized:[number,number,number,number]=[Math.min(bounds[0],bounds[2]),Math.min(bounds[1],bounds[3]),Math.max(bounds[0],bounds[2]),Math.max(bounds[1],bounds[3])]
  return [...new Set(collection.features.flatMap(feature=>{
    const id=feature.properties?.n13AtomId,geometry=feature.geometry
    if(typeof id!=='string'||!geometry)return[]
    const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates
    return Array.isArray(lines)&&lines.some(line=>lineIntersectsBounds(line,normalized))?[id]:[]
  }))]
}
export const excludeManualAtoms=(selection:ManualSelection,atomIds:string[]):ManualSelection=>{
  return atomIds.reduce(excludeManualAtom,selection)
}
export type ContinuityCandidatePath={atomIds:string[];sourceFeatureIndices:number[];classes:string[];lengthMeters:number;detourRatio:number;progressRatio:number;autoEligible:boolean;rejectionReasons?:string[]}
export type ContinuityGap={gapId:string;gapKind:string;referencePart:number;referenceGapMeters:number;geometryGapMeters:number;upstreamN13AtomId:string;downstreamN13AtomId:string;candidatePathCount:number;candidatePaths:ContinuityCandidatePath[];decision:string}
export type ContinuitySummary={checkedCount:number;autoResolvedCount:number;unresolvedCount:number;topologyCheckedCount:number;referenceCheckedCount:number;autoResolvedTopologyCount:number}
export const continuitySummaryText=(summary:ContinuitySummary)=>
  `${summary.checkedCount} transitions checked · ${summary.autoResolvedCount} connected / auto repaired · ${summary.unresolvedCount} unresolved`
export const isUnresolvedGap=(gap:ContinuityGap)=>gap.decision.startsWith('unresolved-')
export const gapReviewQueue=(gaps:ContinuityGap[],ignored:Set<string>,handled=new Set<string>())=>
  gaps.filter(gap=>isUnresolvedGap(gap)&&!ignored.has(gap.gapId)&&!handled.has(gap.gapId))
export const nextReviewGap=(gaps:ContinuityGap[],currentId:string,ignored:Set<string>,handled:Set<string>)=>{
  const remaining=gapReviewQueue(gaps,ignored,handled)
  const currentIndex=gaps.findIndex(gap=>gap.gapId===currentId)
  return remaining.find(gap=>gaps.findIndex(item=>item.gapId===gap.gapId)>currentIndex)||remaining[0]
}
export const isAddableCandidate=(path:Pick<ContinuityCandidatePath,'atomIds'>)=>path.atomIds.length>0
export const selectedContinuityCheck=(checks:ContinuityGap[],id?:string)=>checks.find(check=>check.gapId===id)
export const continuityInspection=(checks:ContinuityGap[],gaps:ContinuityGap[],id:string|undefined,ignored:Set<string>)=>{
  const check=selectedContinuityCheck(checks,id)
  const queue=gapReviewQueue(gaps,ignored)
  const unresolved=check&&isUnresolvedGap(check)?check:undefined
  return{check,unresolved,queue,showCandidateActions:Boolean(unresolved),queueIndex:unresolved?queue.findIndex(item=>item.gapId===unresolved.gapId):-1}
}
export const includeGapCandidate=(selection:ManualSelection,path:Pick<ContinuityCandidatePath,'atomIds'>):ManualSelection=>
  isAddableCandidate(path)?path.atomIds.reduce(includeManualAtom,selection):selection
export const applyGapCandidateEdit=(selection:ManualSelection,path:Pick<ContinuityCandidatePath,'atomIds'>,
  gaps:ContinuityGap[],currentId:string,ignored:Set<string>,handled:Set<string>)=>{
  if(!isAddableCandidate(path))return undefined
  const nextHandled=new Set([...handled,currentId])
  return{manualSelection:includeGapCandidate(selection,path),handledGapIds:nextHandled,
    nextGapId:nextReviewGap(gaps,currentId,ignored,nextHandled)?.gapId,
    finalPreviewId:undefined,stage:'MATCH_EDITED' as const}
}
export const candidatePathGeoJson=(sourceAtoms:{features:{properties?:Record<string,unknown>|null}[]},path?:Pick<ContinuityCandidatePath,'atomIds'>)=>({
  type:'FeatureCollection' as const,features:path?sourceAtoms.features.filter(feature=>path.atomIds.includes(String(feature.properties?.n13AtomId||''))):[]})
export const deriveAvailableAtomIds=(automaticIds:string[],adjacency:Record<string,string[]>,selection:ManualSelection):string[]=>{
  const excluded=new Set(selection.exclude)
  const selected=new Set([...automaticIds.filter(id=>!excluded.has(id)),...selection.include.filter(id=>!excluded.has(id))])
  const available=new Set<string>()
  selected.forEach(id=>(adjacency[id]||[]).forEach(neighbor=>{
    if(!selected.has(neighbor)&&!excluded.has(neighbor))available.add(neighbor)
  }))
  return [...available].sort()
}
type ReviewCollections={autoSelected:AtomCollection;autoSelectedSourceAtoms:AtomCollection;sourceAtoms:AtomCollection;sourceAdjacency:Record<string,string[]>}
const geometryLines=(geometry?:LineGeometry|null):Position[][]=>{
  if(!geometry||!Array.isArray(geometry.coordinates))return[]
  return (geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates) as Position[][]
}
const squaredDistance=(a:Position,b:Position)=>(a[0]-b[0])**2+(a[1]-b[1])**2
const projection=(point:Position,a:Position,b:Position)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy
  if(!length2)return{ratio:0,distance2:squaredDistance(point,a)}
  const ratio=((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2
  const projected:[number,number]=[a[0]+ratio*dx,a[1]+ratio*dy]
  return{ratio,distance2:squaredDistance(point,projected)}
}
const subtractSelectedLines=(complete:LineGeometry,selected:LineGeometry[]):LineGeometry|null=>{
  const remainder:Position[][]=[]
  for(const line of geometryLines(complete))for(let index=1;index<line.length;index++){
    const a=line[index-1],b=line[index],cuts:[number,number][]=[]
    for(const selectedLine of selected.flatMap(geometryLines))for(let selectedIndex=1;selectedIndex<selectedLine.length;selectedIndex++){
      const first=projection(selectedLine[selectedIndex-1],a,b),last=projection(selectedLine[selectedIndex],a,b)
      const epsilon=Math.max(squaredDistance(a,b),1)*1e-16
      if(first.distance2<=epsilon&&last.distance2<=epsilon){
        const low=Math.max(0,Math.min(first.ratio,last.ratio)),high=Math.min(1,Math.max(first.ratio,last.ratio))
        if(high>low)cuts.push([low,high])
      }
    }
    cuts.sort((left,right)=>left[0]-right[0])
    let cursor=0
    for(const[low,high]of cuts){
      if(low>cursor)remainder.push([[a[0]+cursor*(b[0]-a[0]),a[1]+cursor*(b[1]-a[1])],[a[0]+low*(b[0]-a[0]),a[1]+low*(b[1]-a[1])]])
      cursor=Math.max(cursor,high)
    }
    if(cursor<1)remainder.push([[a[0]+cursor*(b[0]-a[0]),a[1]+cursor*(b[1]-a[1])],b])
  }
  const nonzero=remainder.filter(line=>squaredDistance(line[0],line[1])>1e-20)
  if(!nonzero.length)return null
  return nonzero.length===1?{type:'LineString',coordinates:nonzero[0]}:{type:'MultiLineString',coordinates:nonzero}
}
const endpointDistanceMeters=(a:Position,b:Position)=>{
  const radians=Math.PI/180,latitude=(a[1]+b[1])/2*radians
  const x=(a[0]-b[0])*radians*Math.cos(latitude),y=(a[1]-b[1])*radians
  return Math.hypot(x,y)*6371008.8
}
const endpoints=(geometry?:LineGeometry|null)=>geometryLines(geometry).flatMap(line=>line.length?[line[0],line.at(-1)!]:[])
export const deriveManualReviewLayers=(source:ReviewCollections,selection:ManualSelection,endpointSnapMeters=2)=>{
  const included=new Set(selection.include),excluded=new Set(selection.exclude)
  const atom=(feature:AtomFeature)=>String(feature.properties?.n13AtomId||'')
  const automaticIds=[...new Set(source.autoSelected.features.map(atom))]
  const available=new Set(deriveAvailableAtomIds(automaticIds,source.sourceAdjacency,selection))
  const state=(feature:AtomFeature,manualSelection:string,finalCuratedSelection:boolean,selectionReason:string)=>
    ({...feature,properties:{...(feature.properties||{}),manualSelection,finalCuratedSelection,selectionReason}})
  const automatic=source.autoSelected.features.filter(feature=>!excluded.has(atom(feature))&&!included.has(atom(feature)))
    .map(feature=>state(feature,'none',true,'accepted-auto'))
  const unselected=source.sourceAtoms.features.filter(feature=>available.has(atom(feature)))
    .map(feature=>state(feature,'none',false,'rejected-auto'))
  const manuallyIncluded=source.sourceAtoms.features
    .filter(feature=>included.has(atom(feature)))
    .map(feature=>state(feature,'include',true,'accepted-manual'))
  const manuallyExcluded=source.sourceAtoms.features
    .filter(feature=>excluded.has(atom(feature))).map(feature=>state(feature,'exclude',false,'rejected-manual'))
  const selectedFrontierEndpoints=source.sourceAtoms.features
    .filter(feature=>included.has(atom(feature))||automaticIds.includes(atom(feature)))
  const automaticByAtom=new Map<string,LineGeometry[]>()
  source.autoSelected.features.forEach(feature=>{if(feature.geometry){const id=atom(feature);automaticByAtom.set(id,[...(automaticByAtom.get(id)||[]),feature.geometry])}})
  const promotionRemainders=source.sourceAtoms.features.flatMap(feature=>{
    const id=atom(feature),selected=automaticByAtom.get(id)
    if(!feature.geometry||!selected||included.has(id)||excluded.has(id))return[]
    const geometry=subtractSelectedLines(feature.geometry,selected)
    if(!geometry)return[]
    const otherEndpoints=selectedFrontierEndpoints.filter(other=>atom(other)!==id).flatMap(other=>endpoints(other.geometry))
    if(!endpoints(geometry).some(point=>otherEndpoints.some(other=>endpointDistanceMeters(point,other)<=endpointSnapMeters)))return[]
    return[state({...feature,geometry,properties:{...(feature.properties||{}),automaticSelection:false,promotionRemainder:true}},'none',false,'promotion-remainder')]
  })
  return{autoSelected:{features:automatic},unselectedShortlist:{features:[...unselected,...promotionRemainders]},
    manuallyIncluded:{features:manuallyIncluded},manuallyExcluded:{features:manuallyExcluded}}
}
export const previewStageAfterManualEdit=(stage:PreviewStage):PreviewStage=>stage==='NO_MATCH'||stage==='MATCH_RUNNING'?stage:'MATCH_EDITED'
export const canConnect=(stage:PreviewStage)=>stage==='MATCH_READY'||stage==='MATCH_EDITED'||stage==='FINAL_READY'
export const canBuild=(stage:PreviewStage,finalPreviewId?:string)=>stage==='FINAL_READY'&&Boolean(finalPreviewId)

export const findRegisteredRoad=(roads:Road[],canonicalId:string):Road|undefined=>roads.find(item=>item.id===canonicalId)
export const resolveDeletableRoad=(roads:Road[],canonicalId:string,editing?:string):Road|undefined=>{
  if(editing===canonicalId)return findRegisteredRoad(roads,editing)
  return findRegisteredRoad(roads,canonicalId)
}
export const deletionConfirmation=(road:Pick<Road,'id'|'displayName'>,references:{id:string;displayName:string}[])=>{
  const used=references.length?`\n\nUsed by projects:\n${references.map(item=>`- ${item.displayName} (${item.id})`).join('\n')}\nThese project configs will NOT be modified automatically.`:''
  return `Delete ${road.displayName}?\n${road.id}\n\nThis will remove the registered road and its generated road-specific outputs. Shared N13/OSM source datasets will not be deleted.${used}`
}
export const deletionApiPaths=(registeredId:string)=>({references:`/api/roads/${registeredId}/references`,delete:`/api/roads/${registeredId}`})
export type AuthoredLocation={id:string;displayName:string;coordinates:[number,number];presentationType:'reveal-area';revealRadiusPx:number}
export const emptyLocation=():AuthoredLocation=>({id:'',displayName:'',coordinates:[139.7,35.69],presentationType:'reveal-area',revealRadiusPx:120})
