import type maplibregl from 'maplibre-gl'
import type { Position } from 'geojson'
import type { JurisdictionFeature, JurisdictionSelection } from '../data/jurisdictions'

export const JURISDICTION_FOCUS_DURATION = 780
export const JURISDICTION_FOCUS_PADDING = 100
export const JURISDICTION_FOCUS_MAX_ZOOM = 12

function visitPositions(value:unknown, visit:(position:Position)=>void):void {
  if(!Array.isArray(value))return
  if(typeof value[0]==='number'&&typeof value[1]==='number'){visit(value as Position);return}
  value.forEach(item=>visitPositions(item,visit))
}

export function jurisdictionBounds(features:JurisdictionFeature[]):[[number,number],[number,number]]|null {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
  features.forEach(feature=>visitPositions(feature.geometry.coordinates,position=>{
    minX=Math.min(minX,position[0]);minY=Math.min(minY,position[1]);maxX=Math.max(maxX,position[0]);maxY=Math.max(maxY,position[1])
  }))
  return Number.isFinite(minX)?[[minX,minY],[maxX,maxY]]:null
}

export function focusJurisdiction(map:maplibregl.Map,features:JurisdictionFeature[],reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches):void {
  const bounds=jurisdictionBounds(features)
  if(!bounds)return
  map.fitBounds(bounds,{padding:JURISDICTION_FOCUS_PADDING,maxZoom:JURISDICTION_FOCUS_MAX_ZOOM,duration:reducedMotion?0:JURISDICTION_FOCUS_DURATION})
}

const selectionKey=(selection:JurisdictionSelection)=>selection?`${selection.level}:${selection.value}`:null

export function createJurisdictionFocusTracker(initialSelection:JurisdictionSelection){
  let previous=selectionKey(initialSelection)
  return (selection:JurisdictionSelection,features:JurisdictionFeature[]):boolean=>{
    const next=selectionKey(selection),changed=next!==previous
    previous=next
    return Boolean(changed&&next&&features.length)
  }
}
