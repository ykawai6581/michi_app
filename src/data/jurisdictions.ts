import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson'

export const JURISDICTION_MANIFEST_PATH = 'data/jurisdictions/manifest.json'
export const JURISDICTION_SEARCH_INDEX_PATH = 'data/jurisdictions/search-index.json'
export type JurisdictionSelection = { level:'municipality'|'parent'; value:string } | null
export type JurisdictionDisplayMode = 'municipality'|'parent-city'
export type JurisdictionResolution = 'low'|'high'
export interface JurisdictionLayerConfig { enabled:boolean; provider:string; prefecture:string; resolution:JurisdictionResolution; snapshotDate:string|null; displayMode:JurisdictionDisplayMode; selection:JurisdictionSelection }
export interface JurisdictionProperties {
  jurisdictionId:string; snapshotDate:string; prefectureName:string; parentJurisdictionName?:string;
  municipalityName:string; administrativeCode?:string; sourceResourceId?:string; sourceProvider:string; sourceDataset:string;
  sourceResolution?:JurisdictionResolution; jurisdictionLevel?:'parent'; jurisdictionName?:string; memberCount?:number;
  memberJurisdictionIds?:string[]; sourceResourceIds?:string[]; derived?:boolean; derivation?:string
}
export type JurisdictionFeature = Feature<Polygon|MultiPolygon, JurisdictionProperties>
export type JurisdictionCollection = FeatureCollection<Polygon|MultiPolygon, JurisdictionProperties>
export interface JurisdictionSnapshot { path:string; featureCount:number; parentDisplayPath?:string; parentDisplayFeatureCount?:number }
export interface JurisdictionResolutionManifest { displayName:string; availableDates:string[]; snapshots:Record<string,JurisdictionSnapshot> }
export interface JurisdictionPrefectureManifest {
  displayName:string; resolutions?:Partial<Record<JurisdictionResolution,JurisdictionResolutionManifest>>;
  /** Schema v1 compatibility: these entries are interpreted as low resolution. */
  availableDates?:string[]; snapshots?:Record<string,JurisdictionSnapshot>
}
export interface JurisdictionManifest { schemaVersion:number; providers:Record<string,{displayName:string;dataset:string;datasetName:string;sourceUrl:string;caution:string;prefectures:Record<string,JurisdictionPrefectureManifest>}> }
export interface JurisdictionSearchEntry { provider:string; prefecture:string; name:string; level:'municipality'|'parent'; dates:Partial<Record<JurisdictionResolution,string[]>> }
export interface JurisdictionStoryTarget { name:string; level:'municipality'|'parent'; provider:string; prefecture:string; snapshotDate:string; resolution:JurisdictionResolution }

export const disabledJurisdictionLayer = ():JurisdictionLayerConfig => ({enabled:false,provider:'geoshape',prefecture:'13',resolution:'low',snapshotDate:null,displayMode:'municipality',selection:null})

export function normalizeJurisdictionConfig(value?:Partial<JurisdictionLayerConfig>):JurisdictionLayerConfig {
  const fallback=disabledJurisdictionLayer()
  return {...fallback,...value,enabled:value?.enabled===true,resolution:value?.resolution==='high'?'high':'low',displayMode:value?.displayMode==='parent-city'?'parent-city':'municipality',selection:value?.selection??null}
}

async function fetchJson<T>(path:string, fetcher:typeof fetch):Promise<T>{
  const response=await fetcher(`${import.meta.env.BASE_URL}${path}`)
  if(!response.ok)throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export function jurisdictionResolution(prefecture:JurisdictionPrefectureManifest|undefined,resolution:JurisdictionResolution):JurisdictionResolutionManifest|undefined {
  if(!prefecture)return undefined
  if(prefecture.resolutions?.[resolution])return prefecture.resolutions[resolution]
  if(resolution==='low'&&prefecture.availableDates&&prefecture.snapshots)return {displayName:'Low',availableDates:prefecture.availableDates,snapshots:prefecture.snapshots}
  return undefined
}

export function jurisdictionSnapshotDate(prefecture:JurisdictionPrefectureManifest|undefined,resolution:JurisdictionResolution,current:string|null):string|null {
  const available=jurisdictionResolution(prefecture,resolution)?.availableDates??[]
  return current&&available.includes(current)?current:available.at(-1)??null
}

export const loadJurisdictionManifest=(fetcher:typeof fetch=fetch)=>fetchJson<JurisdictionManifest>(JURISDICTION_MANIFEST_PATH,fetcher)
export const loadJurisdictionSearchIndex=(fetcher:typeof fetch=fetch)=>fetchJson<JurisdictionSearchEntry[]>(JURISDICTION_SEARCH_INDEX_PATH,fetcher)

export const jurisdictionTargetKey = (target:JurisdictionStoryTarget) => `${target.provider}/${target.prefecture}/${target.resolution}/${target.snapshotDate}/${target.level}/${target.name}`

export async function loadJurisdictionSnapshot(manifest:JurisdictionManifest, config:JurisdictionLayerConfig, fetcher:typeof fetch=fetch):Promise<JurisdictionCollection>{
  const prefecture=manifest.providers[config.provider]?.prefectures[config.prefecture]
  if(!prefecture)throw new Error(`Jurisdiction provider/prefecture is unavailable: ${config.provider}/${config.prefecture}`)
  const selectedResolution=jurisdictionResolution(prefecture,config.resolution)
  if(!selectedResolution)throw new Error(`Jurisdiction resolution is unavailable: ${config.provider}/${config.prefecture}/${config.resolution}`)
  const date=jurisdictionSnapshotDate(prefecture,config.resolution,config.snapshotDate)
  if(!date)throw new Error(`No jurisdiction snapshots are available for ${config.provider}/${config.prefecture}/${config.resolution}`)
  const snapshot=selectedResolution.snapshots[date]
  const path=config.displayMode==='parent-city'?snapshot.parentDisplayPath:snapshot.path
  if(!path)throw new Error(`Parent-city display is unavailable for ${config.provider}/${config.prefecture}/${config.resolution}/${date}`)
  return fetchJson<JurisdictionCollection>(`data/jurisdictions/${path}`,fetcher)
}

export async function loadExactJurisdictionSnapshot(manifest:JurisdictionManifest,target:JurisdictionStoryTarget,fetcher:typeof fetch=fetch):Promise<JurisdictionCollection>{
  const resolution=jurisdictionResolution(manifest.providers[target.provider]?.prefectures[target.prefecture],target.resolution)
  const snapshot=resolution?.snapshots[target.snapshotDate]
  if(!snapshot)throw new Error(`Jurisdiction snapshot unavailable: ${target.provider}/${target.prefecture}/${target.resolution}/${target.snapshotDate}`)
  const path=target.level==='parent'?snapshot.parentDisplayPath:snapshot.path
  if(!path)throw new Error(`Jurisdiction snapshot unavailable: ${target.provider}/${target.prefecture}/${target.resolution}/${target.snapshotDate}`)
  return fetchJson<JurisdictionCollection>(`data/jurisdictions/${path}`,fetcher)
}

export function findJurisdiction(collection:JurisdictionCollection,target:JurisdictionStoryTarget):JurisdictionFeature {
  const feature=collection.features.find(feature=>target.level==='parent'
    ? feature.properties.jurisdictionLevel==='parent'&&feature.properties.municipalityName===target.name
    : feature.properties.jurisdictionLevel!=='parent'&&feature.properties.municipalityName===target.name)
  if(!feature)throw new Error(`Jurisdiction not found: ${target.name} · ${target.level} · ${target.snapshotDate} · ${target.resolution}`)
  return feature
}

export function selectedJurisdictions(collection:JurisdictionCollection, selection:JurisdictionSelection):JurisdictionFeature[]{
  if(!selection)return []
  if(selection.level==='parent')return collection.features.filter(feature=>feature.properties.parentJurisdictionName===selection.value||(feature.properties.jurisdictionLevel==='parent'&&feature.properties.municipalityName===selection.value))
  return collection.features.filter(feature=>feature.properties.municipalityName===selection.value)
}

export function reconcileJurisdictionSelection(collection:JurisdictionCollection, selection:JurisdictionSelection):JurisdictionSelection {
  if(!selection||selection.level==='parent')return selection
  return selectedJurisdictions(collection,selection).length?selection:null
}
