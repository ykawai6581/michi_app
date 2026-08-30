import { describe, expect, it } from 'vitest'
import { LAYER_IDS, SOURCE_IDS } from './config'
import { setProjectLayerVisibility } from './layers'

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
})
