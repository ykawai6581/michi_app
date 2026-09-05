import { describe, expect, it } from 'vitest'
import { DEFAULT_HIGHLIGHT_STYLE, HISTORICAL_ROAD_LABEL_COLOR, JURISDICTION_HIGHLIGHT_COLOR, REGION_HIGHLIGHT_COLOR, ROAD_LABEL_COLOR, SHUKUBA_LABEL_COLOR, STATION_LABEL_COLOR } from './highlightDefaults'

describe('default highlight style', () => {
  it('uses the road, region, station, and shukuba presentation colors', () => {
    expect(DEFAULT_HIGHLIGHT_STYLE.roadColor).toBe('#FF7B00')
    expect(DEFAULT_HIGHLIGHT_STYLE.historicalRoadColor).toBe('#5C3838')
    expect(DEFAULT_HIGHLIGHT_STYLE.historicalRoadColor).toBe(HISTORICAL_ROAD_LABEL_COLOR)
    expect(DEFAULT_HIGHLIGHT_STYLE.regionColor).toBe('#C84646')
    expect(DEFAULT_HIGHLIGHT_STYLE.stationColor).toBe('#65668F')
    expect(DEFAULT_HIGHLIGHT_STYLE.shukubaColor).toBe('#7F612A')
    expect(DEFAULT_HIGHLIGHT_STYLE.regionColor).toBe(REGION_HIGHLIGHT_COLOR)
    expect(DEFAULT_HIGHLIGHT_STYLE.roadColor).toBe(ROAD_LABEL_COLOR)
    expect(DEFAULT_HIGHLIGHT_STYLE.stationColor).toBe(STATION_LABEL_COLOR)
    expect(DEFAULT_HIGHLIGHT_STYLE.shukubaColor).toBe(SHUKUBA_LABEL_COLOR)
    expect(JURISDICTION_HIGHLIGHT_COLOR).toBe('#FFFFFF')
    expect(REGION_HIGHLIGHT_COLOR).toBe('#C84646')
  })
})
