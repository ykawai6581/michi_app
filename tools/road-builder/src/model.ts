export type ManualSelection={include:string[];exclude:string[]}
export type Road={id:string;displayName:string;entityType:'named-road'|'statutory-road';jurisdiction:string;aliases:string[];reference:{type:string;names?:string[];tags?:string[];ref?:string;network?:string;excludeNames?:string[];excludeNameTags?:string[];[key:string]:unknown};n13:{classifications:string[]};matching:Record<string,number>;networkSelection?:Record<string,number>;manualSelection?:ManualSelection;manualSelectionN13Fingerprint?:string;[key:string]:unknown}
export const emptyRoad=():Road=>({id:'',displayName:'',entityType:'named-road',jurisdiction:'Tokyo',aliases:[],reference:{type:'osm-name',names:[],tags:['name','name:ja','name:en','alt_name']},n13:{classifications:[]},matching:{sampleIntervalMeters:5,maximumMedianResidualMeters:20,maximumP90ResidualMeters:25,coverageToleranceMeters:25}})
export const uniqueAdd=(values:string[],value:string)=>value.trim()&&!values.includes(value.trim())?[...values,value.trim()]:values
export const removeAt=(values:string[],index:number)=>values.filter((_,i)=>i!==index)
export const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(v=>v!==value):[...values,value]
export type StatutoryNetworkChoice='national'|'prefectural'|'custom'
export const statutoryNetworkChoice=(network?:string):StatutoryNetworkChoice=>network==='JP:national'?'national':network==='JP:prefectural'?'prefectural':'custom'
export const applyStatutoryNetworkChoice=(reference:Road['reference'],choice:StatutoryNetworkChoice):Road['reference']=>({...reference,network:choice==='national'?'JP:national':choice==='prefectural'?'JP:prefectural':reference.network||''})

export const diagnosticLayerIds=['allCandidates','residualRejected','autoSelectedSourceAtoms','referenceExcluded','reference','ownership','autoSelected','unselectedShortlist','manuallyIncluded','manuallyExcluded','finalConnected'] as const
export type DiagnosticLayerId=typeof diagnosticLayerIds[number]
export type LayerVisibility=Record<DiagnosticLayerId,boolean>
export const initialLayerVisibility=():LayerVisibility=>({reference:true,referenceExcluded:false,ownership:true,autoSelected:true,autoSelectedSourceAtoms:false,unselectedShortlist:true,manuallyIncluded:true,manuallyExcluded:false,finalConnected:true,allCandidates:false,residualRejected:false})
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
export const deriveManualReviewLayers=(source:ReviewCollections,selection:ManualSelection)=>{
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
  return{autoSelected:{features:automatic},unselectedShortlist:{features:unselected},
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
