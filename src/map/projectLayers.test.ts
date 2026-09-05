import { describe, expect, it } from 'vitest'
import { LAYER_IDS, SOURCE_IDS } from './config'
import { ACTIVE_LINE_SHADOW_BLUR, ACTIVE_LINE_SHADOW_COLOR, ACTIVE_LINE_SHADOW_OPACITY, addDataLayers, pointLabelOffset, POINT_LABEL_SIZE, SELECTED_POINT_RADIUS, selectedShukubaFilter, selectedStationFilter, setBasemapMode, setProjectLayerVisibility, updatePointOverlayStyle } from './layers'
import { initialLayerVisibility, initialPointOverlayStyle } from './overlayState'
import { lineColorExpression } from './highlight'
import { ACTIVE_LINE_CASING_EXTRA_WIDTH, ACTIVE_LINE_SHADOW_EXTRA_WIDTH, JURISDICTION_HIGHLIGHT_COLOR, REGION_HIGHLIGHT_COLOR } from './highlightDefaults'
import { POINT_ICON_IDS, pointIconSize } from './pointIcons'

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
    expect(layer.layout).toMatchObject({'symbol-placement':'point','text-rotate':['get','bearing'],'text-rotation-alignment':'map','text-allow-overlap':false,'text-ignore-placement':false})
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
  it('uses white only for jurisdiction emphasis layers',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    const paint=(id:string)=>layers.find(layer=>layer.id===id)?.paint as Record<string,unknown>
    expect(paint(LAYER_IDS.jurisdictionHighlightFill)['fill-color']).toBe(JURISDICTION_HIGHLIGHT_COLOR)
    expect(paint(LAYER_IDS.jurisdictionHighlightLine)['line-color']).toBe(JURISDICTION_HIGHLIGHT_COLOR)
    expect(paint(LAYER_IDS.highlightFill)['fill-color']).toBe(REGION_HIGHLIGHT_COLOR)
    expect(paint(LAYER_IDS.highlightLine)['line-color']).toContain(REGION_HIGHLIGHT_COLOR)
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
  it('renders station and shukuba artwork with its right-hand label as one collision-safe symbol',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    for(const [id,image] of [[LAYER_IDS.stations,POINT_ICON_IDS.stations],[LAYER_IDS.historicalPosts,POINT_ICON_IDS.historicalPosts]]){
      const layer=layers.find(candidate=>candidate.id===id) as {type:string;layout:Record<string,unknown>;paint:Record<string,unknown>}
      expect(layer.type).toBe('symbol')
      expect(layer.layout).toMatchObject({'icon-image':image,'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-anchor':'left','text-justify':'left','icon-allow-overlap':false,'icon-ignore-placement':false,'text-allow-overlap':false,'text-ignore-placement':false,'icon-optional':false,'text-optional':false})
      expect((layer.layout['text-offset'] as number[])[0]).toBeGreaterThan(0)
      expect(layer.paint).not.toHaveProperty('icon-color')
    }
    const index=(id:string)=>layers.findIndex(layer=>layer.id===id)
    expect(index(LAYER_IDS.stations)).toBeGreaterThan(index(LAYER_IDS.highlightLineLabels))
    expect(index(LAYER_IDS.historicalPosts)).toBeGreaterThan(index(LAYER_IDS.jurisdictionHighlightLabel))
  })
  it('renders selected station and shukuba from the highlight source with shared collision-safe artwork',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    for(const [selectedId,normalId,image,filter] of [
      [LAYER_IDS.selectedStationSymbol,LAYER_IDS.stations,POINT_ICON_IDS.stations,selectedStationFilter],
      [LAYER_IDS.selectedShukubaSymbol,LAYER_IDS.historicalPosts,POINT_ICON_IDS.historicalPosts,selectedShukubaFilter],
    ] as const){
      const selected=layers.find(layer=>layer.id===selectedId) as {source:string;filter:unknown;layout:Record<string,unknown>;paint:unknown}
      const normal=layers.find(layer=>layer.id===normalId) as {layout:Record<string,unknown>;paint:unknown}
      expect(selected.source).toBe(SOURCE_IDS.highlight)
      expect(selected.filter).toEqual(filter)
      expect(selected.layout).toEqual(normal.layout)
      expect(selected.paint).toEqual(normal.paint)
      expect(selected.layout).toMatchObject({'icon-image':image,'text-size':POINT_LABEL_SIZE,'text-anchor':'left','icon-allow-overlap':false,'icon-ignore-placement':false,'icon-optional':false,'text-allow-overlap':false,'text-ignore-placement':false,'text-optional':false})
    }
    const index=(id:string)=>layers.findIndex(layer=>layer.id===id)
    expect(index(LAYER_IDS.selectedStationSymbol)).toBeGreaterThan(index(LAYER_IDS.highlightLineLabels))
    expect(index(LAYER_IDS.selectedStationSymbol)).toBeLessThan(index(LAYER_IDS.stations))
    expect(index(LAYER_IDS.selectedShukubaSymbol)).toBeLessThan(index(LAYER_IDS.historicalPosts))
  })
  it('suppresses opaque selected dots and duplicate labels for stations and postId features',()=>{
    const layers:Record<string,unknown>[]=[]
    const map={addLayer:(layer:Record<string,unknown>)=>layers.push(layer),addSource:()=>undefined}
    const collections=new Proxy({}, {get:()=>({type:'FeatureCollection',features:[]})})
    addDataLayers(map as never,{collections} as never)
    const pointFilter=layers.find(layer=>layer.id===LAYER_IDS.highlightPoint)?.filter
    const labelFilter=layers.find(layer=>layer.id===LAYER_IDS.highlightLabels)?.filter
    expect(pointFilter).toContainEqual(['!',['any',['==',['get','type'],'station'],['has','postId']]])
    expect(labelFilter).toContainEqual(pointFilter)
  })
  it('updates visibility on layers that are already added', () => {
    const calls: unknown[][] = []; const map = { setLayoutProperty: (...args: unknown[]) => calls.push(args) }
    setProjectLayerVisibility(map as never, { basemap:'presentation', darkBasemap:false, modernRoads:true, railways:false, stations:true, historicalRoads:false, historicalPosts:true, jurisdictions:false })
    expect(calls).toContainEqual(['railway-tracks','visibility','none'])
    expect(calls).toContainEqual(['railway-stations','visibility','visible'])
    expect(calls).toContainEqual(['jurisdiction-fill','visibility','none'])
    expect(calls.flat()).not.toContain(LAYER_IDS.selectedStationSymbol)
    expect(calls.flat()).not.toContain(LAYER_IDS.selectedShukubaSymbol)
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
  it('updates icon size and label separation without tinting artwork',()=>{
    const calls:unknown[][]=[];const map={setLayoutProperty:(...args:unknown[])=>calls.push(args)}
    const style=initialPointOverlayStyle();style.stations={radius:3};style.historicalPosts={radius:4}
    updatePointOverlayStyle(map as never,style)
    expect(calls).toContainEqual(['railway-stations','icon-size',pointIconSize(3)]);expect(calls).toContainEqual(['railway-stations','text-offset',pointLabelOffset(3,28)])
    expect(calls).toContainEqual(['historical-posts','icon-size',pointIconSize(4)]);expect(calls).not.toEqual(expect.arrayContaining([expect.arrayContaining(['icon-color'])]))
    expect(calls).toContainEqual([LAYER_IDS.selectedStationSymbol,'icon-size',pointIconSize(3)])
    expect(calls).toContainEqual([LAYER_IDS.selectedStationSymbol,'text-size',28])
    expect(calls).toContainEqual([LAYER_IDS.selectedStationSymbol,'text-offset',pointLabelOffset(3,28)])
    expect(calls).toContainEqual([LAYER_IDS.selectedShukubaSymbol,'icon-size',pointIconSize(4)])
  })
  it('applies the effective scene scale to point labels, icons, and offsets',()=>{
    const calls:unknown[][]=[];const map={setLayoutProperty:(...args:unknown[])=>calls.push(args)}
    const style=initialPointOverlayStyle()
    updatePointOverlayStyle(map as never,style,'large',0.5)
    expect(calls).toContainEqual([LAYER_IDS.stations,'text-size',14])
    expect(calls).toContainEqual([LAYER_IDS.stations,'icon-size',pointIconSize()*0.5])
    expect(calls).toContainEqual([LAYER_IDS.stations,'text-offset',pointLabelOffset(style.stations.radius,14,0.5)])
    expect(calls).toContainEqual([LAYER_IDS.selectedShukubaSymbol,'icon-size',pointIconSize()*0.5])
  })
})
