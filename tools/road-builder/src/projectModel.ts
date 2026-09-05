export const projectIdPattern=/^[a-z0-9][a-z0-9-]*$/
export type Bounds={mode:'auto';from:'modernRoads';paddingKm:number}|[number,number,number,number]
export type ProjectConfig={id:string;displayName:string;bounds:Bounds;layers:{modernRoads?:string[];locations?:string[];railways?:{mode:'bbox'}|{mode:'near-modern-roads';distanceKm:number};stations?:{mode:'bbox'};historicalRoads?:string[];historicalPosts?:string[]}}
export type ProjectLayer='modernRoads'|'railways'|'stations'|'historicalRoads'|'historicalPosts'|'locations'
export type ProjectVisibility=Record<ProjectLayer,boolean>

export const emptyProject=():ProjectConfig=>({id:'',displayName:'',bounds:{mode:'auto',from:'modernRoads',paddingKm:3},layers:{modernRoads:[],locations:[],historicalRoads:[],historicalPosts:[]}})
export const initialProjectVisibility=():ProjectVisibility=>({modernRoads:true,railways:true,stations:true,historicalRoads:true,historicalPosts:true,locations:true})
export function toggleProjectLayer(project:ProjectConfig,family:ProjectLayer,value?:string):ProjectConfig{
  const layers={...project.layers}
  if(family==='railways')layers[family]=layers[family]?undefined:{mode:'near-modern-roads',distanceKm:3}
  else if(family==='stations')layers[family]=layers[family]?undefined:{mode:'bbox'}
  else if(value){const selected=layers[family]||[];layers[family]=selected.includes(value)?selected.filter(id=>id!==value):[...selected,value]}
  return{...project,layers}
}
export function selectHistoricalRoute(project:ProjectConfig,routeId:string):ProjectConfig{
  const adding=!(project.layers.historicalRoads||[]).includes(routeId)
  let next=toggleProjectLayer(project,'historicalRoads',routeId)
  if(adding&&!(next.layers.historicalPosts||[]).includes(routeId))next=toggleProjectLayer(next,'historicalPosts',routeId)
  return next
}
export const serializeProject=(project:ProjectConfig)=>JSON.parse(JSON.stringify(project)) as ProjectConfig

export type ProjectSavePlan={existing:boolean;method:'POST'|'PUT';path:string;saveLabel:string;buildLabel:string}
export function projectSavePlan(projectId:string,existingIds:string[]):ProjectSavePlan{
  const existing=existingIds.includes(projectId)
  return existing
    ?{existing,method:'PUT',path:`/api/projects/${projectId}`,saveLabel:'Update Project',buildLabel:'Update & Build'}
    :{existing,method:'POST',path:'/api/projects',saveLabel:'Save Project',buildLabel:'Save & Build'}
}
export const projectDeletionPath=(projectId:string)=>`/api/projects/${projectId}`
export const projectDeletionConfirmation=(project:Pick<ProjectConfig,'id'|'displayName'>)=>`Delete ${project.displayName}?\n${project.id}\n\nThis will remove the project configuration and its built preview output. Shared road and source data will not be deleted.`
