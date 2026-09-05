import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { BasemapMode, LayerVisibility, PointOverlayStyle } from '../types/geo'
import { LAYER_IDS, SOURCE_IDS } from './config'
import type { ProjectData } from '../data/project'
import { ACTIVE_LINE_CASING_EXTRA_WIDTH, ACTIVE_LINE_SHADOW_EXTRA_WIDTH, JURISDICTION_HIGHLIGHT_COLOR, REGION_HIGHLIGHT_COLOR, ROAD_LABEL_COLOR, ROAD_LABEL_HALO_COLOR, ROAD_LABEL_HALO_WIDTH } from './highlightDefaults'
import { lineColorExpression, sceneLineColorExpression } from './highlight'
import { BASE_LINE_LABEL_SIZE_LARGE } from './presentationScale'
import { POINT_ICON_IDS, pointIconSize } from './pointIcons'

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
export const SELECTED_POINT_RADIUS = 10
export const ACTIVE_LINE_SHADOW_COLOR = '#081218'
export const ACTIVE_LINE_SHADOW_BLUR = 4.5
export const ACTIVE_LINE_SHADOW_OPACITY = 0
export const POINT_LABEL_SIZE = 38
export const pointLabelOffset = (radius: number): [number, number] => [pointIconSize(radius) / 2 / POINT_LABEL_SIZE + 0.35, 0]
const selectedStandalonePointFilter: maplibregl.ExpressionSpecification = ['all',['==',['geometry-type'],'Point'],['!',['any',['==',['get','type'],'station'],['has','postId']]]]
const pointSymbolLayout = (iconImage: string, radius: number): maplibregl.SymbolLayerSpecification['layout'] => ({
  'icon-image':iconImage,'icon-size':pointIconSize(radius),'icon-allow-overlap':false,'icon-ignore-placement':false,'icon-optional':false,
  'text-field':['get','name'],'text-size':POINT_LABEL_SIZE,'text-font':['Noto Sans Regular'],'text-anchor':'left','text-justify':'left','text-offset':pointLabelOffset(radius),
  'text-allow-overlap':false,'text-ignore-placement':false,'text-optional':false,
})
export function getPresentationLayerIds(map: maplibregl.Map): string[] {
  return map.getStyle().layers.map((layer) => layer.id)
}

export function addDataLayers(map: maplibregl.Map, project: ProjectData): void {
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
  map.addSource(SOURCE_IDS.jurisdictions,{type:'geojson',data:empty})
  map.addSource(SOURCE_IDS.jurisdictionHighlight,{type:'geojson',data:empty})
  map.addSource(SOURCE_IDS.jurisdictionHighlightLabel,{type:'geojson',data:empty})
  map.addLayer({id:LAYER_IDS.jurisdictionFill,type:'fill',source:SOURCE_IDS.jurisdictions,layout:{visibility:'none'},paint:{'fill-color':'#5d8d83','fill-opacity':0.2}})
  map.addLayer({id:LAYER_IDS.jurisdictionOutline,type:'line',source:SOURCE_IDS.jurisdictions,layout:{visibility:'none'},paint:{'line-color':'#35675e','line-width':1.25,'line-opacity':0.85}})
  map.addSource(SOURCE_IDS.historicalRoads, { type: 'geojson', data: project.collections['historical-roads'] })
  map.addSource(SOURCE_IDS.railways, { type: 'geojson', data: project.collections.railways })
  map.addSource(SOURCE_IDS.modernRoads, { type: 'geojson', data: project.collections['modern-roads'] })
  map.addSource(SOURCE_IDS.historicalPosts, { type: 'geojson', data: project.collections['historical-posts'] })
  map.addSource(SOURCE_IDS.stations, { type: 'geojson', data: project.collections.stations })
  map.addSource(SOURCE_IDS.highlight, { type: 'geojson', data: empty })
  map.addSource(SOURCE_IDS.highlightOsm, { type: 'geojson', data: empty })
  map.addSource(SOURCE_IDS.highlightLineLabels, { type: 'geojson', data: empty })
  map.addLayer({id:LAYER_IDS.jurisdictionHighlightFill,type:'fill',source:SOURCE_IDS.jurisdictionHighlight,paint:{'fill-color':JURISDICTION_HIGHLIGHT_COLOR,'fill-opacity':0}})
  map.addLayer({id:LAYER_IDS.jurisdictionHighlightGlow,type:'line',source:SOURCE_IDS.jurisdictionHighlight,paint:{'line-color':JURISDICTION_HIGHLIGHT_COLOR,'line-width':17,'line-blur':7,'line-opacity':0}})
  map.addLayer({id:LAYER_IDS.jurisdictionHighlightLine,type:'line',source:SOURCE_IDS.jurisdictionHighlight,paint:{'line-color':JURISDICTION_HIGHLIGHT_COLOR,'line-width':4,'line-opacity':0}})
  map.addLayer({ id: LAYER_IDS.historicalRoads, type: 'line', source: SOURCE_IDS.historicalRoads, layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#a06d31','line-width':4,'line-opacity':0.9,'line-dasharray':[2,1] } })
  map.addLayer({ id: LAYER_IDS.railways, type: 'line', source: SOURCE_IDS.railways, paint: { 'line-color':'#31383c','line-width':2,'line-opacity':0.8 } })
  map.addLayer({ id: LAYER_IDS.modernRoads, type: 'line', source: SOURCE_IDS.modernRoads, layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#8b9498','line-width':5,'line-opacity':0.8 } })
  map.addLayer({id:LAYER_IDS.jurisdictionDim,type:'fill',source:SOURCE_IDS.jurisdictions,paint:{'fill-color':'#06151d','fill-opacity':0},filter:['==',['literal',false],true]})
  map.addLayer({ id: LAYER_IDS.highlightFill, type: 'fill', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Polygon'], paint: { 'fill-color':REGION_HIGHLIGHT_COLOR,'fill-opacity':0.35 } })
  map.addLayer({ id: LAYER_IDS.highlightRegionGlow, type: 'line', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Polygon'], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':REGION_HIGHLIGHT_COLOR,'line-width':['+', ['*', 7, ['coalesce', ['get', 'illustrationWidthScale'], 1]], 7],'line-opacity':0.65,'line-blur':4 } })
  map.addLayer({ id: LAYER_IDS.highlightLine, type: 'line', source: SOURCE_IDS.highlight, filter: ['any',['==',['geometry-type'],'Polygon'],['all',['==',['geometry-type'],'LineString'],['!=',['get','activeLine'],true]]], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':['case',['==',['geometry-type'],'LineString'],sceneLineColorExpression(ROAD_LABEL_COLOR),REGION_HIGHLIGHT_COLOR],'line-width':['*', 7, ['coalesce', ['get','illustrationWidthScale'], 1]],'line-opacity':1 } })
  map.addLayer({ id: LAYER_IDS.highlightOsmLine, type: 'line', source: SOURCE_IDS.highlightOsm, filter: ['in',['geometry-type'],['literal',['LineString','MultiLineString']]], layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#1769e0','line-width':3,'line-opacity':0.9,'line-dasharray':[2,1] } })
  const activeLineFilter: maplibregl.FilterSpecification = ['all',['==',['geometry-type'],'LineString'],['==',['get','activeLine'],true]]
  const activeCoreWidth: maplibregl.ExpressionSpecification = ['*', 7, ['coalesce', ['get', 'illustrationWidthScale'], 1]]
  map.addLayer({ id: LAYER_IDS.highlightLineShadow, type: 'line', source: SOURCE_IDS.highlight, filter: activeLineFilter, layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':ACTIVE_LINE_SHADOW_COLOR,'line-width':['+',activeCoreWidth,ACTIVE_LINE_SHADOW_EXTRA_WIDTH],'line-opacity':ACTIVE_LINE_SHADOW_OPACITY,'line-blur':ACTIVE_LINE_SHADOW_BLUR } })
  map.addLayer({ id: LAYER_IDS.highlightLineOutline, type: 'line', source: SOURCE_IDS.highlight, filter: activeLineFilter, layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':'#FFFFFF','line-width':['+',activeCoreWidth,ACTIVE_LINE_CASING_EXTRA_WIDTH],'line-opacity':1 } })
  map.addLayer({ id: LAYER_IDS.highlightLineActive, type: 'line', source: SOURCE_IDS.highlight, filter: activeLineFilter, layout: { 'line-cap':'round','line-join':'round' }, paint: { 'line-color':lineColorExpression(ROAD_LABEL_COLOR),'line-width':activeCoreWidth,'line-opacity':1 } })
  map.addLayer({ id: LAYER_IDS.highlightPointGlow, type: 'circle', source: SOURCE_IDS.highlight, filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color':'#64c2f2','circle-radius':18,'circle-opacity':0.2 } })
  map.addLayer({ id: LAYER_IDS.highlightPoint, type: 'circle', source: SOURCE_IDS.highlight, filter: selectedStandalonePointFilter, paint: { 'circle-color':'#64c2f2','circle-radius':SELECTED_POINT_RADIUS,'circle-opacity':1,'circle-stroke-color':'#fff','circle-stroke-width':3 } })
  map.addLayer({ id: LAYER_IDS.highlightLineLabels, type: 'symbol', source: SOURCE_IDS.highlightLineLabels, layout: { 'symbol-placement':'point','text-field':['get','name'],'text-allow-overlap':false,'text-ignore-placement':false,'text-size':BASE_LINE_LABEL_SIZE_LARGE,'text-font':['Noto Sans Regular'],'text-rotate':['get','bearing'],'text-rotation-alignment':'map' }, paint: { 'text-color':sceneLineColorExpression(ROAD_LABEL_COLOR),'text-halo-color':ROAD_LABEL_HALO_COLOR,'text-halo-width':ROAD_LABEL_HALO_WIDTH } })
  map.addLayer({ id: LAYER_IDS.highlightLabels, type: 'symbol', source: SOURCE_IDS.highlight, filter: ['any',['==',['geometry-type'],'Polygon'],selectedStandalonePointFilter], layout: { 'text-field':['get','name'],'text-size':BASE_LINE_LABEL_SIZE_LARGE,'text-font':['Noto Sans Regular'],'text-offset':['case',['==',['geometry-type'],'Point'],['literal',[0,1.5]],['literal',[0,0]]],'text-anchor':['case',['==',['geometry-type'],'Point'],'top','center'],'text-allow-overlap':false,'text-ignore-placement':false }, paint: { 'text-color':['match',['geometry-type'],'Polygon',REGION_HIGHLIGHT_COLOR,'#64c2f2'],'text-halo-color':'#fff','text-halo-width':ROAD_LABEL_HALO_WIDTH } })
  map.addLayer({id:LAYER_IDS.jurisdictionHighlightLabel,type:'symbol',source:SOURCE_IDS.jurisdictionHighlightLabel,layout:{'text-field':['format',['case',['has','parent'],['concat',['get','parent'],'\n'],''],{'font-scale':0.7},['get','primary'],{'font-scale':1}],'text-size':28,'text-font':['Noto Sans Regular'],'text-anchor':'center','text-variable-anchor':['center','top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'],'text-radial-offset':1.15,'text-padding':4,'text-allow-overlap':false,'text-ignore-placement':false},paint:{'text-color':'#000000','text-halo-color':'#FFFFFF','text-halo-width':2.5,'text-opacity':0,'text-opacity-transition':{'duration':0,'delay':0}}})
  // Point symbols follow active annotations in placement order, so collisions
  // hide the lower-priority station/shukuba rather than the annotation.
  map.addLayer({ id: LAYER_IDS.historicalPosts, type: 'symbol', source: SOURCE_IDS.historicalPosts, layout: pointSymbolLayout(POINT_ICON_IDS.historicalPosts,2.5), paint: { 'text-color':'#405963','text-halo-color':'#fff','text-halo-width':ROAD_LABEL_HALO_WIDTH } })
  map.addLayer({ id: LAYER_IDS.stations, type: 'symbol', source: SOURCE_IDS.stations, layout: pointSymbolLayout(POINT_ICON_IDS.stations,2), paint: { 'text-color':'#405963','text-halo-color':'#fff','text-halo-width':ROAD_LABEL_HALO_WIDTH } })
}

export function setBasemapMode(map: maplibregl.Map, mode: BasemapMode, presentationLayerIds: string[], rekichizuLayerIds: string[] = [], dark = false): void {
  const showPresentation = mode === 'presentation'
  presentationLayerIds.forEach((id) => map.setLayoutProperty(id, 'visibility', showPresentation ? 'visible' : 'none'))
  rekichizuLayerIds.forEach((id) => map.setLayoutProperty(id, 'visibility', mode === 'rekichizu' ? 'visible' : 'none'))
  map.setLayoutProperty(LAYER_IDS.gsiBase, 'visibility', mode === 'gsi' ? 'visible' : 'none')
  map.setPaintProperty(LAYER_IDS.whiteBase, 'background-opacity', mode === 'white' || mode === 'gsi' ? 1 : 0)
  map.setPaintProperty(LAYER_IDS.darkVeil, 'background-opacity', dark ? 0.68 : 0)
}

export function setProjectLayerVisibility(map: maplibregl.Map, visibility: LayerVisibility): void {
  const groups: [string, boolean][] = [[LAYER_IDS.modernRoads,visibility.modernRoads],[LAYER_IDS.railways,visibility.railways],[LAYER_IDS.stations,visibility.stations],[LAYER_IDS.historicalRoads,visibility.historicalRoads],[LAYER_IDS.historicalPosts,visibility.historicalPosts],[LAYER_IDS.jurisdictionFill,visibility.jurisdictions],[LAYER_IDS.jurisdictionOutline,visibility.jurisdictions],[LAYER_IDS.jurisdictionDim,visibility.jurisdictions],[LAYER_IDS.jurisdictionHighlightFill,visibility.jurisdictions],[LAYER_IDS.jurisdictionHighlightGlow,visibility.jurisdictions],[LAYER_IDS.jurisdictionHighlightLine,visibility.jurisdictions],[LAYER_IDS.jurisdictionHighlightLabel,visibility.jurisdictions]]
  groups.forEach(([id, enabled]) => map.setLayoutProperty(id, 'visibility', enabled ? 'visible' : 'none'))
}

export function updatePointOverlayStyle(map: maplibregl.Map, style: PointOverlayStyle): void {
  map.setLayoutProperty(LAYER_IDS.stations, 'icon-size', pointIconSize(style.stations.radius))
  map.setLayoutProperty(LAYER_IDS.stations, 'text-offset', pointLabelOffset(style.stations.radius))
  map.setLayoutProperty(LAYER_IDS.historicalPosts, 'icon-size', pointIconSize(style.historicalPosts.radius))
  map.setLayoutProperty(LAYER_IDS.historicalPosts, 'text-offset', pointLabelOffset(style.historicalPosts.radius))
}
