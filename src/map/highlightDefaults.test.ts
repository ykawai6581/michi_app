import { describe, expect, it } from 'vitest'
import { DEFAULT_HIGHLIGHT_STYLE, REGION_HIGHLIGHT_COLOR, ROAD_LABEL_COLOR } from './highlightDefaults'

describe('default highlight style', () => {
  it('uses the road and region presentation colors', () => {
    expect(DEFAULT_HIGHLIGHT_STYLE.roadColor).toBe('#FF7B00')
    expect(DEFAULT_HIGHLIGHT_STYLE.regionColor).toBe('#C84646')
    expect(DEFAULT_HIGHLIGHT_STYLE.regionColor).toBe(REGION_HIGHLIGHT_COLOR)
    expect(DEFAULT_HIGHLIGHT_STYLE.roadColor).toBe(ROAD_LABEL_COLOR)
  })
})
