import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { sampleData } from '../data/sample'
import type { EntityFeature, HighlightStyle, LayerVisibility } from '../types/geo'
import { createMap } from '../map/createMap'
import { addDataLayers, getPresentationLayerIds, setBasemapMode } from '../map/layers'
import { selectFeature, updateHighlightStyle } from '../map/highlight'
import { LAYER_IDS } from '../map/config'

export interface MapHandle { getMap: () => maplibregl.Map | null }
interface Props { selected: EntityFeature | null; highlightStyle: HighlightStyle; visibility: LayerVisibility; onReady: () => void }
export const MapView = forwardRef<MapHandle, Props>(function MapView({ selected, highlightStyle, visibility, onReady }, ref) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<maplibregl.Map | null>(null); const presentationLayerIds = useRef<string[]>([])
  useImperativeHandle(ref, () => ({ getMap: () => mapRef.current }), [])
  useEffect(() => { if (!container.current) return; const map = createMap(container.current); mapRef.current = map; map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-left'); map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right'); map.on('load', () => { presentationLayerIds.current = getPresentationLayerIds(map); addDataLayers(map, sampleData); onReady() }); return () => { map.remove(); mapRef.current = null } }, [onReady])
  useEffect(() => { const map = mapRef.current; if (map?.loaded() && selected) selectFeature(map, selected) }, [selected])
  useEffect(() => { const map = mapRef.current; if (map?.loaded()) updateHighlightStyle(map, highlightStyle) }, [highlightStyle])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getLayer(LAYER_IDS.gsiBase)) return; setBasemapMode(map, visibility.basemap, presentationLayerIds.current); const groups: [string[], boolean][] = [[[LAYER_IDS.roads],visibility.roads],[[LAYER_IDS.historicalRoads],visibility.historicalRoads],[[LAYER_IDS.places],visibility.places],[[LAYER_IDS.chomeFill,LAYER_IDS.chomeLine],visibility.chome]]; groups.forEach(([ids,on]) => ids.forEach((id) => map.setLayoutProperty(id,'visibility',on?'visible':'none'))) }, [visibility])
  return <div ref={container} className="map" aria-label="東京周辺の歴史地図" />
})
