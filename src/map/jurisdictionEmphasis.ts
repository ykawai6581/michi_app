import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { JurisdictionFeature, JurisdictionSelection } from '../data/jurisdictions'
import { LAYER_IDS, SOURCE_IDS } from './config'

export const JURISDICTION_EMPHASIS_DURATION = 780
const FINAL = { dim:0.58, fill:0.2, line:0.96, glow:0.32, label:1 }
type EmphasisState = typeof FINAL
type Animation = { frame:number; state:EmphasisState }
const activeAnimations = new WeakMap<maplibregl.Map, Animation>()
const currentStates = new WeakMap<maplibregl.Map, EmphasisState>()

export function jurisdictionDimFilter(features:JurisdictionFeature[]):maplibregl.FilterSpecification {
  const ids=[...new Set(features.map(feature=>feature.properties.jurisdictionId))]
  return ids.length ? ['!', ['in', ['get','jurisdictionId'], ['literal',ids]]] : ['==', ['literal',false], true]
}

export function jurisdictionLabelText(feature:JurisdictionFeature, selection:JurisdictionSelection):{parent?:string;primary:string} {
  if(selection?.level==='parent')return {primary:selection.value}
  const parent=feature.properties.parentJurisdictionName?.trim()
  return parent?{parent,primary:feature.properties.municipalityName}:{primary:feature.properties.municipalityName}
}

function ringArea(ring:Position[]):number {
  return Math.abs(ring.reduce((sum,point,index)=>{const next=ring[(index+1)%ring.length];return sum+point[0]*next[1]-next[0]*point[1]},0)/2)
}
function geometryArea(geometry:Polygon|MultiPolygon):number {
  const polygonArea=(rings:Position[][])=>ringArea(rings[0]??[])-rings.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0)
  return geometry.type==='Polygon'?polygonArea(geometry.coordinates):geometry.coordinates.reduce((sum,polygon)=>sum+polygonArea(polygon),0)
}

export function jurisdictionEmphasisCollection(features:JurisdictionFeature[],selection:JurisdictionSelection):FeatureCollection {
  if(!features.length)return {type:'FeatureCollection',features:[]}
  const labelFeature=[...features].sort((a,b)=>geometryArea(b.geometry)-geometryArea(a.geometry)||a.properties.jurisdictionId.localeCompare(b.properties.jurisdictionId))[0]
  return {type:'FeatureCollection',features:features.map(feature=>feature===labelFeature?{...feature,properties:{...feature.properties,emphasisLabel:true,...jurisdictionLabelText(feature,selection)}}:{...feature,properties:{...feature.properties,emphasisLabel:false}})}
}

function apply(map:maplibregl.Map,state:EmphasisState):void {
  map.setPaintProperty(LAYER_IDS.jurisdictionDim,'fill-opacity',state.dim)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightFill,'fill-opacity',state.fill)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLine,'line-opacity',state.line)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightGlow,'line-opacity',state.glow)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLabel,'text-opacity',state.label)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLabel,'text-halo-width',state.label*2.5)
  currentStates.set(map,state)
}

export function updateJurisdictionEmphasis(map:maplibregl.Map,features:JurisdictionFeature[],selection:JurisdictionSelection):void {
  const previous=activeAnimations.get(map)
  if(previous)cancelAnimationFrame(previous.frame)
  if(features.length)map.setFilter(LAYER_IDS.jurisdictionDim,jurisdictionDimFilter(features))
  const source=map.getSource(SOURCE_IDS.jurisdictionHighlight) as GeoJSONSource
  const data=jurisdictionEmphasisCollection(features,selection)
  if(features.length)source.setData(data)
  const from:EmphasisState=features.length
    ? {dim:currentStates.get(map)?.dim??0,fill:0,line:0,glow:0,label:0}
    : (currentStates.get(map)??FINAL)
  const to:EmphasisState=features.length?FINAL:{dim:0,fill:0,line:0,glow:0,label:0}
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches
  if(reduced){apply(map,to);if(!features.length)map.setFilter(LAYER_IDS.jurisdictionDim,jurisdictionDimFilter([]));source.setData(features.length?data:{type:'FeatureCollection',features:[]});activeAnimations.delete(map);return}
  apply(map,from)
  const started=performance.now()
  const frame=(now:number)=>{
    const progress=Math.min((now-started)/JURISDICTION_EMPHASIS_DURATION,1)
    const eased=1-Math.pow(1-progress,3)
    const mix=(key:keyof EmphasisState)=>from[key]+(to[key]-from[key])*eased
    const state={dim:mix('dim'),fill:mix('fill'),line:mix('line'),label:features.length?(progress<0.25?0:1-Math.pow(1-(progress-0.25)/0.75,3)):mix('label'),glow:features.length?(progress<0.68?0.55*Math.min(eased/0.97,1):0.55+(FINAL.glow-0.55)*((progress-0.68)/0.32)):mix('glow')}
    apply(map,state)
    if(progress<1){const id=requestAnimationFrame(frame);activeAnimations.set(map,{frame:id,state})}
    else {apply(map,to);if(!features.length){source.setData({type:'FeatureCollection',features:[]});map.setFilter(LAYER_IDS.jurisdictionDim,jurisdictionDimFilter([]))}activeAnimations.delete(map)}
  }
  const id=requestAnimationFrame(frame);activeAnimations.set(map,{frame:id,state:from})
}
