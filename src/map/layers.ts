import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { BasemapMode } from '../types/geo'
import { LAYER_IDS, SOURCE_IDS } from './config'

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
export type DiagnosticVisibility = { osmSource: boolean; osmDerived: boolean; n13: boolean }
export function getPresentationLayerIds(map: maplibregl.Map): string[] {
  return map.getStyle().layers.map((layer) => layer.id)
}

export function addDataLayers(map: maplibregl.Map, data: FeatureCollection): void {
  map.addLayer({ id: LAYER_IDS.whiteBase, type: 'background', paint: { 'background-color': '#f4f2ec', 'background-opacity': 0 } })
  map.addLayer({ id: LAYER_IDS.darkVeil, type: 'background', paint: { 'background-color': '#06151d', 'background-opacity': 0 } })
  map.addSource(SOURCE_IDS.gsiBase, {
    type: 'raster',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
    tileSize: 256,
    minzoom: 2,
    maxzoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
  })
  map.addLayer({ id: LAYER_IDS.gsiBase, type: 'raster', source: SOURCE_IDS.gsiBase, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.72, 'raster-saturation': -0.75, 'raster-contrast': -0.12, 'raster-brightness-max': 0.96 } })
  map.addSource(SOURCE_IDS.entities, { type: 'geojson', data })
  map.addSource(SOURCE_IDS.highlight, { type: 'geojson', data: empty })
  map.addLayer({ id: LAYER_IDS.chomeFill, type: 'fill', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'chome'], paint: { 'fill-color':'#749aa5','fill-opacity':0.16 } })
  map.addLayer({ id: LAYER_IDS.chomeLine, type: 'line', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'chome'], paint: { 'line-color':'#69828b','line-width':1.5,'line-dasharray':[3,2] } })
  map.addLayer({ id: LAYER_IDS.roads, type: 'line', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'road'], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#8b9498','line-width':5,'line-opacity':0.75 } })
  map.addLayer({ id: LAYER_IDS.historicalRoads, type: 'line', source: SOURCE_IDS.entities, filter: ['==',['get','type'],'historical-road'], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#997c56','line-width':4,'line-opacity':0.9,'line-dasharray':[2,1] } })
  map.addLayer({ id: LAYER_IDS.places, type: 'circle', source: SOURCE_IDS.entities, filter: ['in',['get','type'],['literal',['place','historical-place']]], paint: { 'circle-color':['match',['get','type'],'historical-place','#b06e3b','#42697b'],'circle-radius':7,'circle-stroke-color':'#fff','circle-stroke-width':2 } })
  map.addLayer({ id: LAYER_IDS.highlightFill, type: 'fill', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Polygon'], paint: { 'fill-color':'#3264aa','fill-opacity':0.35 } })
  map.addLayer({ id: LAYER_IDS.highlightLineGlow, type: 'line', source: SOURCE_IDS.highlight, filter: ['in',['geometry-type'],['literal',['LineString','Polygon']]], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#fff','line-width':['+', ['*', 7, ['coalesce', ['get', 'illustrationWidthScale'], 1]], 7],'line-opacity':0.65,'line-blur':4 } })
  map.addLayer({ id: LAYER_IDS.highlightLine, type: 'line', source: SOURCE_IDS.highlight, filter: ['in',['geometry-type'],['literal',['LineString','Polygon']]], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':['match',['geometry-type'],'LineString','#ef6262','#3264aa'],'line-width':['*', 7, ['coalesce', ['get', 'illustrationWidthScale'], 1]],'line-opacity':1 } })
  map.addLayer({ id: LAYER_IDS.highlightPointGlow, type: 'circle', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color':'#64c2f2','circle-radius':18,'circle-opacity':0.2 } })
  map.addLayer({ id: LAYER_IDS.highlightPoint, type: 'circle', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color':'#64c2f2','circle-radius':10,'circle-opacity':1,'circle-stroke-color':'#fff','circle-stroke-width':3 } })
  map.addLayer({ id: LAYER_IDS.highlightLineLabels, type: 'symbol', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'LineString'], layout: { 'symbol-placement':'line','symbol-spacing':380,'text-field':['get','name'],'text-size':28,'text-font':['Noto Sans Regular'],'text-keep-upright':true }, paint: { 'text-color':'#ef6262','text-halo-color':'#fff','text-halo-width':3 } })
  map.addLayer({ id: LAYER_IDS.highlightLabels, type: 'symbol', source: SOURCE_IDS.highlight, filter: ['in',['geometry-type'],['literal',['Point','Polygon']]], layout: { 'text-field':['get','name'],'text-size':28,'text-font':['Noto Sans Regular'],'text-offset':['case',['==',['geometry-type'],'Point'],['literal',[0,1.5]],['literal',[0,0]]],'text-anchor':['case',['==',['geometry-type'],'Point'],'top','center'] }, paint: { 'text-color':['match',['geometry-type'],'Polygon','#3264aa','#64c2f2'],'text-halo-color':'#fff','text-halo-width':3 } })
}

export function addDiagnosticLayers(map: maplibregl.Map, road: FeatureCollection, n13: FeatureCollection): void {
  const sourceGeometry = road.features[0]?.properties?.sourceGeometry
  const osmSource: FeatureCollection = sourceGeometry ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: sourceGeometry }] } : empty
  map.addSource(SOURCE_IDS.diagnosticOsmSource, { type: 'geojson', data: osmSource })
  map.addSource(SOURCE_IDS.diagnosticOsmDerived, { type: 'geojson', data: road })
  map.addSource(SOURCE_IDS.diagnosticN13, { type: 'geojson', data: n13 })
  map.addLayer({ id: LAYER_IDS.diagnosticN13, type: 'line', source: SOURCE_IDS.diagnosticN13, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
    // The low-residual population is vivid green; increasingly distant national
    // roads fade through amber to gray. This visualizes evidence without choosing
    // a production cutoff or removing any shortlisted N13 feature.
    'line-color': ['interpolate', ['linear'], ['coalesce', ['get', 'route20_median_m'], 1000], 0, '#00a84f', 10, '#62bd55', 20, '#e5a735', 50, '#b3a69a', 500, '#777b80'],
    'line-width': ['interpolate', ['linear'], ['coalesce', ['get', 'route20_median_m'], 1000], 0, 5, 20, 3, 50, 1.5],
    'line-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'route20_median_m'], 1000], 0, 0.95, 20, 0.85, 50, 0.3, 500, 0.14],
  } })
  map.addLayer({ id: LAYER_IDS.diagnosticOsmSource, type: 'line', source: SOURCE_IDS.diagnosticOsmSource, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#d936a5', 'line-width': 5, 'line-opacity': 0.88, 'line-dasharray': [1, 1] } })
  map.addLayer({ id: LAYER_IDS.diagnosticOsmDerived, type: 'line', source: SOURCE_IDS.diagnosticOsmDerived, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1769e0', 'line-width': 2.5, 'line-opacity': 1 } })
}

export function setDiagnosticVisibility(map: maplibregl.Map, visibility: DiagnosticVisibility): void {
  ;([[LAYER_IDS.diagnosticOsmSource, visibility.osmSource], [LAYER_IDS.diagnosticOsmDerived, visibility.osmDerived], [LAYER_IDS.diagnosticN13, visibility.n13]] as const)
    .forEach(([id, visible]) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'))
}

export function setBasemapMode(map: maplibregl.Map, mode: BasemapMode, presentationLayerIds: string[]): void {
  const showPresentation = mode === 'presentation' || mode === 'dark'
  presentationLayerIds.forEach((id) => map.setLayoutProperty(id, 'visibility', showPresentation ? 'visible' : 'none'))
  map.setLayoutProperty(LAYER_IDS.gsiBase, 'visibility', mode === 'gsi' ? 'visible' : 'none')
  map.setPaintProperty(LAYER_IDS.whiteBase, 'background-opacity', mode === 'white' || mode === 'gsi' ? 1 : 0)
  map.setPaintProperty(LAYER_IDS.darkVeil, 'background-opacity', mode === 'dark' ? 0.68 : 0)
}
