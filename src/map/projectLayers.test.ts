import { describe, expect, it } from 'vitest'
import { LAYER_IDS, SOURCE_IDS } from './config'
import { ACTIVE_LINE_SHADOW_BLUR, ACTIVE_LINE_SHADOW_COLOR, ACTIVE_LINE_SHADOW_OPACITY, addDataLayers, SELECTED_POINT_RADIUS, setBasemapMode, setProjectLayerVisibility, updatePointOverlayStyle } from './layers'
import { initialLayerVisibility, initialPointOverlayStyle } from './overlayState'
import { lineColorExpression } from './highlight'
import { ACTIVE_LINE_CASING_EXTRA_WIDTH, ACTIVE_LINE_SHADOW_EXTRA_WIDTH } from './highlightDefaults'

describe('project map layer contract', () => {
  it('defines independent sources for all project layers', () => {
    expect(SOURCE_IDS).toMatchObject({ modernRoads:'project-modern-roads', railways:'project-railways', stations:'project-stations', historicalRoads:'project-historical-roads', historicalPosts:'project-historical-posts', highlightLineLabels:'selected-line-label-anchors' })
  })
  it('places selected line labels once from their dedicated Point source',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    const layer=layers.find(candidate=>candidate.id===LAYER_IDS.highlightLineLabels) as {source:string;layout:Record<string,unknown>}
    expect(layer.source).toBe(SOURCE_IDS.highlightLineLabels)
    expect(layer.layout).toMatchObject({'symbol-placement':'point','text-rotate':['get','bearing'],'text-rotation-alignment':'map','text-allow-overlap':true,'text-ignore-placement':true})
    expect(layer.layout).not.toHaveProperty('symbol-spacing')
  })
  it('keeps jurisdiction polygons below roads and its Point label above every road layer',()=>{
    const layers:string[]=[]
    const map={addLayer:(layer:{id:string})=>layers.push(layer.id),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    for(const polygonLayer of [LAYER_IDS.jurisdictionHighlightFill,LAYER_IDS.jurisdictionHighlightGlow,LAYER_IDS.jurisdictionHighlightLine])expect(layers.indexOf(polygonLayer)).toBeLessThan(layers.indexOf(LAYER_IDS.historicalRoads))
    for(const roadLayer of [LAYER_IDS.historicalRoads,LAYER_IDS.modernRoads,LAYER_IDS.highlightLine,LAYER_IDS.highlightLineShadow,LAYER_IDS.highlightLineOutline,LAYER_IDS.highlightLineActive,LAYER_IDS.highlightOsmLine])expect(layers.indexOf(LAYER_IDS.jurisdictionHighlightLabel)).toBeGreaterThan(layers.indexOf(roadLayer))
  })
  it('stacks retained lines, active shadow, white casing, active core, and labels',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    const byId=(id:string)=>layers.find(layer=>layer.id===id) as Record<string,unknown>
    const index=(id:string)=>layers.findIndex(layer=>layer.id===id)
    const activeFilter=['all',['==',['geometry-type'],'LineString'],['==',['get','activeLine'],true]]
    const coreWidth=['*',7,['coalesce',['get','illustrationWidthScale'],1]]
    expect(byId(LAYER_IDS.highlightLineShadow).filter).toEqual(activeFilter)
    expect(byId(LAYER_IDS.highlightLineOutline).filter).toEqual(activeFilter)
    expect(byId(LAYER_IDS.highlightLineActive).filter).toEqual(activeFilter)
    expect(byId(LAYER_IDS.highlightLine).filter).toEqual(['any',['==',['geometry-type'],'Polygon'],['all',['==',['geometry-type'],'LineString'],['!=',['get','activeLine'],true]]])
    expect(byId(LAYER_IDS.highlightLineShadow).paint).toMatchObject({'line-color':ACTIVE_LINE_SHADOW_COLOR,'line-width':['+',coreWidth,ACTIVE_LINE_SHADOW_EXTRA_WIDTH],'line-blur':ACTIVE_LINE_SHADOW_BLUR,'line-opacity':ACTIVE_LINE_SHADOW_OPACITY})
    expect(byId(LAYER_IDS.highlightLineOutline).paint).toMatchObject({'line-color':'#FFFFFF','line-width':['+',coreWidth,ACTIVE_LINE_CASING_EXTRA_WIDTH]})
    expect(byId(LAYER_IDS.highlightLineActive).paint).toMatchObject({'line-color':lineColorExpression('#FF7B00'),'line-width':coreWidth})
    expect(index(LAYER_IDS.highlightLine)).toBeLessThan(index(LAYER_IDS.highlightLineShadow))
    expect(index(LAYER_IDS.highlightLineShadow)).toBeLessThan(index(LAYER_IDS.highlightLineOutline))
    expect(index(LAYER_IDS.highlightLineOutline)).toBeLessThan(index(LAYER_IDS.highlightLineActive))
    expect(index(LAYER_IDS.highlightLineActive)).toBeLessThan(index(LAYER_IDS.highlightLineLabels))
    expect(index(LAYER_IDS.jurisdictionHighlightLabel)).toBeGreaterThan(index(LAYER_IDS.highlightLineActive))
  })
  it('defines independently toggleable rendering layers', () => {
    expect([LAYER_IDS.modernRoads,LAYER_IDS.railways,LAYER_IDS.stations,LAYER_IDS.historicalRoads,LAYER_IDS.historicalPosts]).toEqual(['modern-roads','railway-tracks','railway-stations','historical-roads','historical-posts'])
  })
  it('updates visibility on layers that are already added', () => {
    const calls: unknown[][] = []; const map = { setLayoutProperty: (...args: unknown[]) => calls.push(args) }
    setProjectLayerVisibility(map as never, { basemap:'presentation', darkBasemap:false, modernRoads:true, railways:false, stations:true, historicalRoads:false, historicalPosts:true, jurisdictions:false })
    expect(calls).toContainEqual(['railway-tracks','visibility','none'])
    expect(calls).toContainEqual(['railway-stations','visibility','visible'])
    expect(calls).toContainEqual(['jurisdiction-fill','visibility','none'])
    expect(calls).toHaveLength(12)
  })
  it('starts railways and stations hidden while historical posts remain visible',()=>{
    expect(initialLayerVisibility()).toMatchObject({basemap:'presentation',darkBasemap:false,railways:false,stations:false,historicalPosts:true,jurisdictions:false})
  })
  it('switches only namespaced basemap layers without replacing the map style',()=>{
    const calls:unknown[][]=[];const map={setLayoutProperty:(...args:unknown[])=>calls.push(args),setPaintProperty:(...args:unknown[])=>calls.push(args)}
    setBasemapMode(map as never,'rekichizu',['osm-background'],['basemap-rekichizu-land','basemap-rekichizu-road'])
    expect(calls).toContainEqual(['osm-background','visibility','none'])
    expect(calls).toContainEqual(['basemap-rekichizu-road','visibility','visible'])
    expect(map).not.toHaveProperty('setStyle')
  })
  it.each(['presentation','rekichizu'] as const)('applies dark mode over the selected %s basemap', (basemap) => {
    const calls:unknown[][]=[];const map={setLayoutProperty:(...args:unknown[])=>calls.push(args),setPaintProperty:(...args:unknown[])=>calls.push(args)}
    setBasemapMode(map as never,basemap,['osm-background'],['basemap-rekichizu-land'],true)
    expect(calls).toContainEqual(['osm-background','visibility',basemap==='presentation'?'visible':'none'])
    expect(calls).toContainEqual(['basemap-rekichizu-land','visibility',basemap==='rekichizu'?'visible':'none'])
    expect(calls).toContainEqual([LAYER_IDS.darkVeil,'background-opacity',0.68])
  })
  it('keeps selected points substantially larger than both base point defaults',()=>{
    const style=initialPointOverlayStyle();expect(SELECTED_POINT_RADIUS).toBeGreaterThan(style.stations.radius*3);expect(SELECTED_POINT_RADIUS).toBeGreaterThan(style.historicalPosts.radius*3)
  })
  it('updates point radius and color without replacing source data',()=>{
    const calls:unknown[][]=[];const map={setPaintProperty:(...args:unknown[])=>calls.push(args)}
    const style=initialPointOverlayStyle();style.stations={radius:3,color:'#112233'};style.historicalPosts={radius:4,color:'#445566'}
    updatePointOverlayStyle(map as never,style)
    expect(calls).toContainEqual(['railway-stations','circle-radius',3]);expect(calls).toContainEqual(['railway-stations','circle-color','#112233'])
    expect(calls).toContainEqual(['historical-posts','circle-radius',4]);expect(calls).toContainEqual(['historical-posts','circle-color','#445566'])
    expect(Object.keys(map)).not.toContain('getSource')
  })
})
