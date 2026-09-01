import { describe, expect, it } from 'vitest'
import { LAYER_IDS, SOURCE_IDS } from './config'
import { SELECTED_POINT_RADIUS, setBasemapMode, setProjectLayerVisibility, updatePointOverlayStyle } from './layers'
import { initialLayerVisibility, initialPointOverlayStyle } from './overlayState'

describe('project map layer contract', () => {
  it('defines independent sources for all project layers', () => {
    expect(SOURCE_IDS).toMatchObject({ modernRoads:'project-modern-roads', railways:'project-railways', stations:'project-stations', historicalRoads:'project-historical-roads', historicalPosts:'project-historical-posts' })
  })
  it('defines independently toggleable rendering layers', () => {
    expect([LAYER_IDS.modernRoads,LAYER_IDS.railways,LAYER_IDS.stations,LAYER_IDS.historicalRoads,LAYER_IDS.historicalPosts]).toEqual(['modern-roads','railway-tracks','railway-stations','historical-roads','historical-posts'])
  })
  it('updates visibility on layers that are already added', () => {
    const calls: unknown[][] = []; const map = { setLayoutProperty: (...args: unknown[]) => calls.push(args) }
    setProjectLayerVisibility(map as never, { basemap:'presentation', modernRoads:true, railways:false, stations:true, historicalRoads:false, historicalPosts:true })
    expect(calls).toContainEqual(['railway-tracks','visibility','none'])
    expect(calls).toContainEqual(['railway-stations','visibility','visible'])
    expect(calls).toHaveLength(5)
  })
  it('starts railways and stations hidden while historical posts remain visible',()=>{
    expect(initialLayerVisibility()).toMatchObject({basemap:'presentation',railways:false,stations:false,historicalPosts:true})
  })
  it('switches only namespaced basemap layers without replacing the map style',()=>{
    const calls:unknown[][]=[];const map={setLayoutProperty:(...args:unknown[])=>calls.push(args),setPaintProperty:(...args:unknown[])=>calls.push(args)}
    setBasemapMode(map as never,'rekichizu',['osm-background'],['basemap-rekichizu-land','basemap-rekichizu-road'])
    expect(calls).toContainEqual(['osm-background','visibility','none'])
    expect(calls).toContainEqual(['basemap-rekichizu-road','visibility','visible'])
    expect(map).not.toHaveProperty('setStyle')
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
