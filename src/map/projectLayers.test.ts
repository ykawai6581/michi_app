import { describe, expect, it } from 'vitest'
import { LAYER_IDS, SOURCE_IDS } from './config'
import { addDataLayers, SELECTED_POINT_RADIUS, setBasemapMode, setProjectLayerVisibility, updatePointOverlayStyle } from './layers'
import { initialLayerVisibility, initialPointOverlayStyle } from './overlayState'
import { REGION_HIGHLIGHT_COLOR } from './highlightDefaults'
import { lineColorExpression } from './highlight'

describe('project map layer contract', () => {
  it('defines independent sources for all project layers', () => {
    expect(SOURCE_IDS).toMatchObject({ modernRoads:'project-modern-roads', railways:'project-railways', stations:'project-stations', historicalRoads:'project-historical-roads', historicalPosts:'project-historical-posts' })
  })
  it('keeps jurisdiction polygons below roads and its Point label above every road layer',()=>{
    const layers:string[]=[]
    const map={addLayer:(layer:{id:string})=>layers.push(layer.id),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    for(const polygonLayer of [LAYER_IDS.jurisdictionHighlightFill,LAYER_IDS.jurisdictionHighlightGlow,LAYER_IDS.jurisdictionHighlightLine])expect(layers.indexOf(polygonLayer)).toBeLessThan(layers.indexOf(LAYER_IDS.historicalRoads))
    for(const roadLayer of [LAYER_IDS.historicalRoads,LAYER_IDS.modernRoads,LAYER_IDS.highlightLineGlow,LAYER_IDS.highlightLine,LAYER_IDS.highlightOsmLine])expect(layers.indexOf(LAYER_IDS.jurisdictionHighlightLabel)).toBeGreaterThan(layers.indexOf(roadLayer))
  })
  it('uses region defaults for jurisdiction emphasis and filters line glow to the active road or railway',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    for(const id of [LAYER_IDS.jurisdictionHighlightFill,LAYER_IDS.jurisdictionHighlightGlow,LAYER_IDS.jurisdictionHighlightLine]){
      expect((layers.find(layer=>layer.id===id)?.paint as Record<string,unknown>)[id===LAYER_IDS.jurisdictionHighlightFill?'fill-color':'line-color']).toBe(REGION_HIGHLIGHT_COLOR)
    }
    expect(layers.find(layer=>layer.id===LAYER_IDS.highlightLineGlow)?.filter).toEqual(['any',['==',['geometry-type'],'Polygon'],['all',['==',['geometry-type'],'LineString'],['==',['get','activeLineGlow'],true]]])
    expect(layers.find(layer=>layer.id===LAYER_IDS.highlightLine)?.filter).toEqual(['in',['geometry-type'],['literal',['LineString','Polygon']]])
    expect((layers.find(layer=>layer.id===LAYER_IDS.highlightLine)?.paint as Record<string,unknown>)['line-color']).toEqual(['case',['==',['geometry-type'],'LineString'],lineColorExpression('#FF7B00'),'#C84646'])
    expect((layers.find(layer=>layer.id===LAYER_IDS.highlightLineLabels)?.paint as Record<string,unknown>)['text-color']).toEqual(lineColorExpression('#FF7B00'))
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
