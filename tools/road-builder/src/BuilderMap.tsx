import{useEffect,useRef}from'react'
import maplibregl,{GeoJSONSource,Map as MlMap}from'maplibre-gl'
import type{ProjectLayer,ProjectVisibility}from'./projectModel'
type FC=GeoJSON.FeatureCollection
const ids:ProjectLayer[]=['modernRoads','railways','stations','historicalRoads','historicalPosts']
const definitions:Record<ProjectLayer,{type:'line'|'circle';paint:object}>={
  modernRoads:{type:'line',paint:{'line-color':'#d92727','line-width':5}},
  railways:{type:'line',paint:{'line-color':'#44515a','line-width':1.5}},
  stations:{type:'circle',paint:{'circle-color':'#1769aa','circle-radius':2,'circle-stroke-color':'white','circle-stroke-width':1}},
  historicalRoads:{type:'line',paint:{'line-color':'#8b5a2b','line-width':3,'line-dasharray':[3,2]}},
  historicalPosts:{type:'circle',paint:{'circle-color':'#d18b00','circle-radius':2.5,'circle-stroke-color':'#5d3b00','circle-stroke-width':1}},
}
export default function BuilderMap({layers,visibility,bounds,onFeature}:{layers:Partial<Record<ProjectLayer,FC>>;visibility:ProjectVisibility;bounds?:[number,number,number,number];onFeature:(properties:object)=>void}){
 const node=useRef<HTMLDivElement>(null),map=useRef<MlMap|null>(null)
 useEffect(()=>{if(!node.current)return;map.current=new maplibregl.Map({container:node.current,style:{version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256}},layers:[{id:'osm',type:'raster',source:'osm'}]},center:[139.7,35.68],zoom:9});map.current.addControl(new maplibregl.NavigationControl());return()=>{map.current?.remove();map.current=null}},[])
 useEffect(()=>{const instance=map.current;if(!instance)return;const sync=()=>{if(!instance.getSource('project-selected')){instance.addSource('project-selected',{type:'geojson',data:{type:'FeatureCollection',features:[]}});instance.addLayer({id:'project-selected-line',type:'line',source:'project-selected',filter:['in',['geometry-type'],['literal',['LineString','MultiLineString']]],paint:{'line-color':'#ff1744','line-width':8,'line-opacity':.9}});instance.addLayer({id:'project-selected-point',type:'circle',source:'project-selected',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#ff1744','circle-radius':10,'circle-stroke-color':'white','circle-stroke-width':3}})}ids.forEach(id=>{const data=layers[id],source=instance.getSource(id)as GeoJSONSource|undefined;if(source&&data)source.setData(data);else if(data){instance.addSource(id,{type:'geojson',data});const definition=definitions[id];instance.addLayer({id,source:id,type:definition.type,paint:definition.paint,layout:{visibility:visibility[id]?'visible':'none'}} as maplibregl.LayerSpecification);instance.on('click',id,event=>{const feature=event.features?.[0];if(feature){(instance.getSource('project-selected')as GeoJSONSource).setData({type:'FeatureCollection',features:[feature as GeoJSON.Feature]});onFeature(feature.properties||{})}})}if(instance.getLayer(id))instance.setLayoutProperty(id,'visibility',data&&visibility[id]?'visible':'none')});if(bounds)instance.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:64,duration:400})};if(instance.loaded())sync();else instance.once('load',sync)},[layers,visibility,bounds,onFeature])
 return <div ref={node} className="map"/>
}
