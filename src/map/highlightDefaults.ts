import type { HighlightStyle } from '../types/geo'

export const ROAD_LABEL_COLOR = '#FF7B00'
export const HISTORICAL_ROAD_LABEL_COLOR = '#5C3838'
export const REGION_HIGHLIGHT_COLOR = '#C84646'
export const JURISDICTION_HIGHLIGHT_COLOR = '#FFFFFF'
export const ROAD_LABEL_HALO_COLOR = '#FFFFFF'
export const ROAD_LABEL_HALO_WIDTH = 3
export const ACTIVE_LINE_CASING_EXTRA_WIDTH = 6
export const ACTIVE_LINE_SHADOW_EXTRA_WIDTH = 14
export const STATION_LABEL_COLOR = '#65668F'
export const SHUKUBA_LABEL_COLOR = '#7F612A'

export const DEFAULT_HIGHLIGHT_STYLE: HighlightStyle = {
  roadColor: ROAD_LABEL_COLOR,
  historicalRoadColor: HISTORICAL_ROAD_LABEL_COLOR,
  locationColor: '#64c2f2',
  stationColor: STATION_LABEL_COLOR,
  shukubaColor: SHUKUBA_LABEL_COLOR,
  regionColor: REGION_HIGHLIGHT_COLOR,
  width: 7,
  opacity: 1,
  glow: true,
  animate: true,
  annotationSize: 'large',
}
