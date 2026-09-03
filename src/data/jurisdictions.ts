import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson'

export const JURISDICTION_MANIFEST_PATH = 'data/jurisdictions/manifest.json'
export type JurisdictionSelection = { level:'municipality'|'parent'; value:string } | null
export type JurisdictionDisplayMode = 'municipality'|'parent-city'
export interface JurisdictionLayerConfig { enabled:boolean; provider:string; prefecture:string; snapshotDate:string|null; displayMode:JurisdictionDisplayMode; selection:JurisdictionSelection }
export interface JurisdictionProperties {
  jurisdictionId:string; snapshotDate:string; prefectureName:string; parentJurisdictionName?:string;
  municipalityName:string; administrativeCode?:string; sourceResourceId?:string; sourceProvider:string; sourceDataset:string;
  jurisdictionLevel?:'parent'; jurisdictionName?:string; memberCount?:number; memberJurisdictionIds?:string[];
  sourceResourceIds?:string[]; derived?:boolean; derivation?:string
}
export type JurisdictionFeature = Feature<Polygon|MultiPolygon, JurisdictionProperties>
export type JurisdictionCollection = FeatureCollection<Polygon|MultiPolygon, JurisdictionProperties>
export interface JurisdictionManifest { schemaVersion:number; providers:Record<string,{displayName:string;dataset:string;datasetName:string;sourceUrl:string;caution:string;prefectures:Record<string,{displayName:string;availableDates:string[];snapshots:Record<string,{path:string;featureCount:number;parentDisplayPath?:string;parentDisplayFeatureCount?:number}>}>}> }

export const disabledJurisdictionLayer = ():JurisdictionLayerConfig => ({enabled:false,provider:'geoshape',prefecture:'13',snapshotDate:null,displayMode:'municipality',selection:null})

export function normalizeJurisdictionConfig(value?:Partial<JurisdictionLayerConfig>):JurisdictionLayerConfig {
  const fallback=disabledJurisdictionLayer()
  return {...fallback,...value,enabled:value?.enabled===true,displayMode:value?.displayMode==='parent-city'?'parent-city':'municipality',selection:value?.selection??null}
}

async function fetchJson<T>(path:string, fetcher:typeof fetch):Promise<T>{
  const response=await fetcher(`${import.meta.env.BASE_URL}${path}`)
  if(!response.ok)throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export const loadJurisdictionManifest=(fetcher:typeof fetch=fetch)=>fetchJson<JurisdictionManifest>(JURISDICTION_MANIFEST_PATH,fetcher)

export async function loadJurisdictionSnapshot(manifest:JurisdictionManifest, config:JurisdictionLayerConfig, fetcher:typeof fetch=fetch):Promise<JurisdictionCollection>{
  const prefecture=manifest.providers[config.provider]?.prefectures[config.prefecture]
  if(!prefecture)throw new Error(`Jurisdiction provider/prefecture is unavailable: ${config.provider}/${config.prefecture}`)
  const date=config.snapshotDate && prefecture.availableDates.includes(config.snapshotDate)?config.snapshotDate:prefecture.availableDates.at(-1)
  if(!date)throw new Error(`No jurisdiction snapshots are available for ${config.provider}/${config.prefecture}`)
  const snapshot=prefecture.snapshots[date]
  const path=config.displayMode==='parent-city'?snapshot.parentDisplayPath:snapshot.path
  if(!path)throw new Error(`Parent-city display is unavailable for ${config.provider}/${config.prefecture}/${date}`)
  return fetchJson<JurisdictionCollection>(`data/jurisdictions/${path}`,fetcher)
}

export function selectedJurisdictions(collection:JurisdictionCollection, selection:JurisdictionSelection):JurisdictionFeature[]{
  if(!selection)return []
  if(selection.level==='parent')return collection.features.filter(feature=>
    feature.properties.parentJurisdictionName===selection.value
    || (feature.properties.jurisdictionLevel==='parent'&&feature.properties.municipalityName===selection.value)
  )
  return collection.features.filter(feature=>feature.properties.municipalityName===selection.value)
}

export function reconcileJurisdictionSelection(collection:JurisdictionCollection, selection:JurisdictionSelection):JurisdictionSelection {
  if(!selection||selection.level==='parent')return selection
  return selectedJurisdictions(collection,selection).length?selection:null
}
