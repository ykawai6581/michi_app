import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { JurisdictionFeature, JurisdictionSelection } from '../data/jurisdictions'
import { LAYER_IDS, SOURCE_IDS } from './config'

export const JURISDICTION_EMPHASIS_DURATION = 780
const FINAL = { dim:0.58, fill:0.2, line:0.96, glow:0.32 }
type EmphasisState = typeof FINAL
type Animation = { frame:number; state:EmphasisState }
type LabelProperties = { parent?:string; primary:string; selectionKey:string }
const activeAnimations = new WeakMap<maplibregl.Map, Animation>()
const currentStates = new WeakMap<maplibregl.Map, EmphasisState>()
const empty:FeatureCollection = {type:'FeatureCollection',features:[]}

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
function polygonArea(rings:Position[][]):number {
  return ringArea(rings[0]??[])-rings.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0)
}
function polygonComponents(feature:JurisdictionFeature):Position[][][] {
  return feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates
}
function pointInRing(point:Position,ring:Position[]):boolean {
  let inside=false
  for(let index=0,previous=ring.length-1;index<ring.length;previous=index++){
    const a=ring[index],b=ring[previous]
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside
  }
  return inside
}
function pointInPolygon(point:Position,rings:Position[][]):boolean {
  return Boolean(rings[0]&&pointInRing(point,rings[0])&&!rings.slice(1).some(ring=>pointInRing(point,ring)))
}
function interiorPoint(rings:Position[][]):Position {
  const outer=rings[0]
  const bounds=outer.reduce(([minX,minY,maxX,maxY],point)=>[Math.min(minX,point[0]),Math.min(minY,point[1]),Math.max(maxX,point[0]),Math.max(maxY,point[1])],[Infinity,Infinity,-Infinity,-Infinity])
  const centroid=outer.reduce(([x,y],point)=>[x+point[0],y+point[1]],[0,0]).map(value=>value/outer.length)
  if(pointInPolygon(centroid,rings))return centroid
  const heights=[0.5,0.4,0.6,0.3,0.7,0.2,0.8]
  let best:Position|undefined,bestWidth=-1
  for(const fraction of heights){
    const y=bounds[1]+(bounds[3]-bounds[1])*fraction
    const intersections=rings.flatMap(ring=>ring.slice(1).flatMap((point,index)=>{const previous=ring[index];return (previous[1]>y)!==(point[1]>y)?[previous[0]+(y-previous[1])*(point[0]-previous[0])/(point[1]-previous[1])]:[]})).sort((a,b)=>a-b)
    for(let index=0;index+1<intersections.length;index+=1){const candidate:Position=[(intersections[index]+intersections[index+1])/2,y];const width=intersections[index+1]-intersections[index];if(width>bestWidth&&pointInPolygon(candidate,rings)){best=candidate;bestWidth=width}}
  }
  return best??outer[0]
}

export function jurisdictionLabelCollection(features:JurisdictionFeature[],selection:JurisdictionSelection):FeatureCollection<Point,LabelProperties> {
  if(!features.length||!selection)return {type:'FeatureCollection',features:[]}
  const candidates=features.flatMap(feature=>polygonComponents(feature).map((rings,index)=>({feature,rings,index,area:polygonArea(rings)})))
  candidates.sort((a,b)=>b.area-a.area||a.feature.properties.jurisdictionId.localeCompare(b.feature.properties.jurisdictionId)||a.index-b.index)
  const selected=candidates[0]
  const properties={...jurisdictionLabelText(selected.feature,selection),selectionKey:`${selection.level}:${selection.value}`}
  const label:Feature<Point,LabelProperties>={type:'Feature',properties,geometry:{type:'Point',coordinates:interiorPoint(selected.rings)}}
  return {type:'FeatureCollection',features:[label]}
}

function apply(map:maplibregl.Map,state:EmphasisState):void {
  map.setPaintProperty(LAYER_IDS.jurisdictionDim,'fill-opacity',state.dim)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightFill,'fill-opacity',state.fill)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLine,'line-opacity',state.line)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightGlow,'line-opacity',state.glow)
  currentStates.set(map,state)
}

export function jurisdictionLabelOpacity(progress:number):number {
  if(progress<=0.25)return 0
  if(progress>=0.7)return 1
  const linear=(progress-0.25)/0.45
  return 1-Math.pow(1-linear,3)
}

export function updateJurisdictionEmphasis(map:maplibregl.Map,features:JurisdictionFeature[],selection:JurisdictionSelection):void {
  const previous=activeAnimations.get(map)
  if(previous)cancelAnimationFrame(previous.frame)
  if(features.length)map.setFilter(LAYER_IDS.jurisdictionDim,jurisdictionDimFilter(features))
  const polygonSource=map.getSource(SOURCE_IDS.jurisdictionHighlight) as GeoJSONSource
  const labelSource=map.getSource(SOURCE_IDS.jurisdictionHighlightLabel) as GeoJSONSource
  const polygons:FeatureCollection<Polygon|MultiPolygon>={type:'FeatureCollection',features}
  const label=jurisdictionLabelCollection(features,selection)
  labelSource.setData(label)
  if(features.length)polygonSource.setData(polygons)
  const from:EmphasisState=features.length?{dim:currentStates.get(map)?.dim??0,fill:0,line:0,glow:0}:(currentStates.get(map)??FINAL)
  const to:EmphasisState=features.length?FINAL:{dim:0,fill:0,line:0,glow:0}
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches
  if(reduced){apply(map,to);map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLabel,'text-opacity',features.length?1:0);if(!features.length){map.setFilter(LAYER_IDS.jurisdictionDim,jurisdictionDimFilter([]));polygonSource.setData(empty)}activeAnimations.delete(map);return}
  apply(map,from)
  map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLabel,'text-opacity',0)
  const started=performance.now()
  const frame=(now:number)=>{
    const progress=Math.min((now-started)/JURISDICTION_EMPHASIS_DURATION,1)
    const eased=1-Math.pow(1-progress,3)
    const mix=(key:keyof EmphasisState)=>from[key]+(to[key]-from[key])*eased
    const state={dim:mix('dim'),fill:mix('fill'),line:mix('line'),glow:features.length?(progress<0.68?0.55*Math.min(eased/0.97,1):0.55+(FINAL.glow-0.55)*((progress-0.68)/0.32)):mix('glow')}
    apply(map,state)
    map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLabel,'text-opacity',features.length?jurisdictionLabelOpacity(progress):0)
    if(progress<1){const id=requestAnimationFrame(frame);activeAnimations.set(map,{frame:id,state})}
    else {apply(map,to);map.setPaintProperty(LAYER_IDS.jurisdictionHighlightLabel,'text-opacity',features.length?1:0);if(!features.length){polygonSource.setData(empty);map.setFilter(LAYER_IDS.jurisdictionDim,jurisdictionDimFilter([]))}activeAnimations.delete(map)}
  }
  const id=requestAnimationFrame(frame);activeAnimations.set(map,{frame:id,state:from})
}
