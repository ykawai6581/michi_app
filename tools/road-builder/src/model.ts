export type Road={id:string;displayName:string;entityType:'named-road'|'statutory-road';jurisdiction:string;aliases:string[];reference:{type:string;names?:string[];tags?:string[];ref?:string;network?:string;excludeNames?:string[];excludeNameTags?:string[];[key:string]:unknown};n13:{classifications:string[]};matching:Record<string,number|string[]>;networkSelection?:Record<string,number>;[key:string]:unknown}
export const emptyRoad=():Road=>({id:'',displayName:'',entityType:'named-road',jurisdiction:'Tokyo',aliases:[],reference:{type:'osm-name',names:[],tags:['name','name:ja','name:en','alt_name']},n13:{classifications:[]},matching:{sampleIntervalMeters:5,maximumMedianResidualMeters:20,maximumP90ResidualMeters:25,coverageToleranceMeters:25}})
export const uniqueAdd=(values:string[],value:string)=>value.trim()&&!values.includes(value.trim())?[...values,value.trim()]:values
export const removeAt=(values:string[],index:number)=>values.filter((_,i)=>i!==index)
export const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(v=>v!==value):[...values,value]
export type StatutoryNetworkChoice='national'|'prefectural'|'custom'
export const statutoryNetworkChoice=(network?:string):StatutoryNetworkChoice=>network==='JP:national'?'national':network==='JP:prefectural'?'prefectural':'custom'
export const applyStatutoryNetworkChoice=(reference:Road['reference'],choice:StatutoryNetworkChoice):Road['reference']=>({...reference,network:choice==='national'?'JP:national':choice==='prefectural'?'JP:prefectural':reference.network||''})

export const diagnosticLayerIds=['rejected','candidates','referenceExcluded','reference','selected'] as const
export type DiagnosticLayerId=typeof diagnosticLayerIds[number]
export type LayerVisibility=Record<DiagnosticLayerId,boolean>
export const initialLayerVisibility=():LayerVisibility=>({reference:true,referenceExcluded:true,selected:true,candidates:false,rejected:false})
export const toggleLayerVisibility=(visibility:LayerVisibility,id:DiagnosticLayerId):LayerVisibility=>({...visibility,[id]:!visibility[id]})
export const emptyDiagnosticState=()=>({layers:{},analysis:undefined,discovered:[] as string[],picked:{}})

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
