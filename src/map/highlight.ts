import bbox from '@turf/bbox'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { EntityFeature, HighlightStyle } from '../types/geo'
import { LAYER_IDS, SOURCE_IDS } from './config'

export function selectFeature(map: maplibregl.Map, feature: EntityFeature): void {
  ;(map.getSource(SOURCE_IDS.highlight) as GeoJSONSource).setData(feature)
  if (feature.geometry.type === 'Point') map.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 15, duration: 900 })
  else { const bounds = bbox(feature); map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]], { padding: 100, maxZoom: 15, duration: 900 }) }
}
export function updateHighlightStyle(map: maplibregl.Map, style: HighlightStyle): void {
  for (const id of [LAYER_IDS.highlightLine, LAYER_IDS.highlightFill, LAYER_IDS.highlightPoint, LAYER_IDS.highlightPointGlow]) map.setPaintProperty(id, id.includes('line') ? 'line-color' : id.includes('fill') ? 'fill-color' : 'circle-color', style.color)
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-width', style.width)
  map.setPaintProperty(LAYER_IDS.highlightLine, 'line-opacity', style.opacity)
  map.setPaintProperty(LAYER_IDS.highlightFill, 'fill-opacity', style.opacity * 0.38)
  map.setPaintProperty(LAYER_IDS.highlightPoint, 'circle-opacity', style.opacity)
}
