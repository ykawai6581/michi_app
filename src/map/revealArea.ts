import type {FeatureCollection,Geometry,Position} from 'geojson'
import type {EntityFeature} from '../types/geo'

type Pixel={x:number;y:number}
export type ScreenProjection={project:(coordinate:[number,number])=>Pixel;unproject:(pixel:[number,number])=>{lng:number;lat:number};getCanvas:()=>{clientWidth:number;clientHeight:number}}
export type RevealCircle={coordinate:[number,number];radius:number}
const empty=():FeatureCollection=>({type:'FeatureCollection',features:[]})
const position=(value:{lng:number;lat:number}):Position=>[value.lng,value.lat]
const distance2=(a:Pixel,b:Pixel)=>(a.x-b.x)**2+(a.y-b.y)**2

export function activeRevealCircle(active:EntityFeature|null,enabled:boolean):RevealCircle|undefined{
  return enabled&&active?.properties.presentationType==='reveal-area'&&active.geometry.type==='Point'
    ?{coordinate:active.geometry.coordinates as [number,number],radius:active.properties.revealRadiusPx??120}:undefined
}

export function buildRevealMask(map:ScreenProjection,reveal?:RevealCircle,steps=64):FeatureCollection{
  if(!reveal)return empty()
  const center=map.project(reveal.coordinate),canvas=map.getCanvas(),margin=Math.max(canvas.clientWidth,canvas.clientHeight)
  const outer=[[-margin,-margin],[canvas.clientWidth+margin,-margin],[canvas.clientWidth+margin,canvas.clientHeight+margin],[-margin,canvas.clientHeight+margin],[-margin,-margin]].map(pixel=>position(map.unproject(pixel as [number,number])))
  // Clockwise screen sampling becomes the opposite winding of the exterior in geographic space.
  const hole=Array.from({length:steps+1},(_,index)=>{const angle=-2*Math.PI*index/steps;return position(map.unproject([center.x+reveal.radius*Math.cos(angle),center.y+reveal.radius*Math.sin(angle)]))})
  return{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[outer,hole]}}]}
}

function clipLine(map:ScreenProjection,line:Position[],circle:RevealCircle):Position[][]{
  const center=map.project(circle.coordinate),pieces:Position[][]=[];let current:Position[]|undefined
  for(let i=1;i<line.length;i++){
    const a=map.project(line[i-1] as [number,number]),b=map.project(line[i] as [number,number]),dx=b.x-a.x,dy=b.y-a.y
    const ox=a.x-center.x,oy=a.y-center.y,A=dx*dx+dy*dy,B=2*(ox*dx+oy*dy),C=ox*ox+oy*oy-circle.radius**2,disc=B*B-4*A*C
    const cuts=[0,1]
    if(A>0&&disc>1e-8){const root=Math.sqrt(disc);for(const t of[(-B-root)/(2*A),(-B+root)/(2*A)])if(t>1e-9&&t<1-1e-9)cuts.push(t)}
    cuts.sort((x,y)=>x-y)
    for(let j=1;j<cuts.length;j++){const low=cuts[j-1],high=cuts[j],mid=(low+high)/2,p={x:a.x+dx*mid,y:a.y+dy*mid}
      if(distance2(p,center)<circle.radius**2){current=undefined;continue}
      const start=position(map.unproject([a.x+dx*low,a.y+dy*low])),end=position(map.unproject([a.x+dx*high,a.y+dy*high]))
      if(current)current.push(end);else{current=[start,end];pieces.push(current)}
    }
  }
  return pieces.filter(piece=>piece.length>1)
}

export function clipFeaturesOutsideReveal(map:ScreenProjection,features:EntityFeature[],circle?:RevealCircle):EntityFeature[]{
  if(!circle)return features.filter(feature=>feature.properties.presentationType!=='reveal-area')
  const center=map.project(circle.coordinate)
  return features.flatMap(feature=>{
    if(feature.properties.presentationType==='reveal-area')return[]
    if(feature.geometry.type==='Point')return distance2(map.project(feature.geometry.coordinates as [number,number]),center)<circle.radius**2?[]:[feature]
    const lines=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:null
    if(!lines)return[feature]
    const pieces=lines.flatMap(line=>clipLine(map,line,circle));if(!pieces.length)return[]
    const geometry:Geometry=pieces.length===1?{type:'LineString',coordinates:pieces[0]}:{type:'MultiLineString',coordinates:pieces}
    return[{...feature,geometry}]
  })
}
