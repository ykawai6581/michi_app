import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { sampleData } from '../data/sample'
import type { EntityFeature, HighlightStyle, LayerVisibility, RoadSourceVisibility } from '../types/geo'
import { createMap } from '../map/createMap'
import { addDataLayers, getPresentationLayerIds, setBasemapMode } from '../map/layers'
import { selectFeatures, updateHighlightStyle } from '../map/highlight'
import { LAYER_IDS, SOURCE_IDS } from '../map/config'

export interface MapHandle { getMap: () => maplibregl.Map | null }
interface Props { selected: EntityFeature[]; highlightStyle: HighlightStyle; visibility: LayerVisibility; roadSources: RoadSourceVisibility; onReady: () => void }
export const MapView = forwardRef<MapHandle, Props>(function MapView({ selected, highlightStyle, visibility, roadSources, onReady }, ref) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<maplibregl.Map | null>(null); const presentationLayerIds = useRef<string[]>([]); const previousSelection = useRef<string[]>([])
  useImperativeHandle(ref, () => ({ getMap: () => mapRef.current }), [])
  useEffect(() => { if (!container.current) return; const map = createMap(container.current); mapRef.current = map; map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-left'); map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right'); map.on('load', () => { presentationLayerIds.current = getPresentationLayerIds(map); addDataLayers(map, sampleData); onReady() }); return () => { map.remove(); mapRef.current = null } }, [onReady])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getSource(SOURCE_IDS.highlight)) return; const focus = selected.find((feature) => !previousSelection.current.includes(feature.properties.id)); previousSelection.current = selected.map((feature) => feature.properties.id); selectFeatures(map, selected, roadSources, focus, highlightStyle.animate) }, [selected, roadSources, highlightStyle.animate])
  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded() && map.getLayer(LAYER_IDS.highlightLine)) updateHighlightStyle(map, highlightStyle) }, [highlightStyle])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getLayer(LAYER_IDS.gsiBase)) return; setBasemapMode(map, visibility.basemap, presentationLayerIds.current); const groups: [string[], boolean][] = [[[LAYER_IDS.roads],visibility.roads],[[LAYER_IDS.historicalRoads],visibility.historicalRoads],[[LAYER_IDS.places],visibility.places],[[LAYER_IDS.chomeFill,LAYER_IDS.chomeLine],visibility.chome]]; groups.forEach(([ids,on]) => ids.forEach((id) => map.setLayoutProperty(id,'visibility',on?'visible':'none'))) }, [visibility])
  return <div ref={container} className="map" aria-label="東京周辺の歴史地図" />
})
