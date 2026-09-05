import type { EntityFeature, MapEntityType } from '../types/geo'

const entityTypeLabels: Record<MapEntityType, string> = {
  road: '現代道路',
  'historical-road': '歴史街道',
  railway: '鉄道',
  station: '駅',
  'historical-place': '宿場',
  place: '地名',
  chome: '町丁目',
  river: '河川',
  water: '水域',
  'terrain-feature': '地形',
  jurisdiction: '歴史的行政区域',
  custom: '地物',
}

export function formatEntityTypeLabel(feature: EntityFeature): string {
  return entityTypeLabels[feature.properties.type]
}
