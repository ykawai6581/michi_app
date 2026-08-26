import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { LAYER_IDS, SOURCE_IDS } from './config'

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
export function addDataLayers(map: maplibregl.Map, data: FeatureCollection): void {
  map.addSource(SOURCE_IDS.entities, { type: 'geojson', data })
  map.addSource(SOURCE_IDS.highlight, { type: 'geojson', data: empty })
  map.addLayer({ id: LAYER_IDS.chomeFill, type: 'fill', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'chome'], paint: { 'fill-color':'#749aa5','fill-opacity':0.16 } })
  map.addLayer({ id: LAYER_IDS.chomeLine, type: 'line', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'chome'], paint: { 'line-color':'#69828b','line-width':1.5,'line-dasharray':[3,2] } })
  map.addLayer({ id: LAYER_IDS.roads, type: 'line', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'road'], paint: { 'line-color':'#8b9498','line-width':5,'line-opacity':0.75 } })
  map.addLayer({ id: LAYER_IDS.historicalRoads, type: 'line', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'historical-road'], paint: { 'line-color':'#997c56','line-width':4,'line-opacity':0.9,'line-dasharray':[2,1] } })
  map.addLayer({ id: LAYER_IDS.places, type: 'circle', source: SOURCE_IDS.entities, filter: ['in',['get','type'],['literal',['place','historical-place']]], paint: { 'circle-color':['match',['get','type'],'historical-place','#b06e3b','#42697b'],'circle-radius':7,'circle-stroke-color':'#fff','circle-stroke-width':2 } })
  map.addLayer({ id: LAYER_IDS.highlightFill, type: 'fill', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Polygon'], paint: { 'fill-color':'#1d9a8a','fill-opacity':0.35 } })
  map.addLayer({ id: LAYER_IDS.highlightLineGlow, type: 'line', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'LineString'], paint: { 'line-color':'#fff','line-width':12,'line-opacity':0.65,'line-blur':4 } })
  map.addLayer({ id: LAYER_IDS.highlightLine, type: 'line', source: SOURCE_IDS.highlight, filter: ['in',['geometry-type'],['literal',['LineString','Polygon']]], paint: { 'line-color':'#1d9a8a','line-width':7,'line-opacity':1 } })
  map.addLayer({ id: LAYER_IDS.highlightPointGlow, type: 'circle', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color':'#1d9a8a','circle-radius':18,'circle-opacity':0.2 } })
  map.addLayer({ id: LAYER_IDS.highlightPoint, type: 'circle', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color':'#1d9a8a','circle-radius':10,'circle-opacity':1,'circle-stroke-color':'#fff','circle-stroke-width':3 } })
}
