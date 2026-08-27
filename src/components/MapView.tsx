import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { sampleData } from '../data/sample'
import type { EntityFeature, HighlightStyle, LayerVisibility } from '../types/geo'
import { createMap } from '../map/createMap'
import { addDataLayers, addDiagnosticLayers, getPresentationLayerIds, setBasemapMode, setDiagnosticVisibility, type DiagnosticVisibility } from '../map/layers'
import { selectFeatures, updateHighlightStyle } from '../map/highlight'
import { LAYER_IDS, SOURCE_IDS } from '../map/config'

export interface MapHandle { getMap: () => maplibregl.Map | null }
interface Props { selected: EntityFeature[]; highlightStyle: HighlightStyle; visibility: LayerVisibility; diagnosticRoad?: EntityFeature; n13: FeatureCollection; diagnosticVisibility: DiagnosticVisibility; onReady: () => void }
export const MapView = forwardRef<MapHandle, Props>(function MapView({ selected, highlightStyle, visibility, diagnosticRoad, n13, diagnosticVisibility, onReady }, ref) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<maplibregl.Map | null>(null); const presentationLayerIds = useRef<string[]>([]); const previousSelection = useRef<string[]>([])
  useImperativeHandle(ref, () => ({ getMap: () => mapRef.current }), [])
  useEffect(() => { if (!container.current || !diagnosticRoad) return; const map = createMap(container.current); mapRef.current = map; map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-left'); map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right'); map.on('load', () => { presentationLayerIds.current = getPresentationLayerIds(map); addDataLayers(map, sampleData); addDiagnosticLayers(map, { type: 'FeatureCollection', features: [diagnosticRoad] }, n13); onReady() }); return () => { map.remove(); mapRef.current = null } }, [diagnosticRoad, n13, onReady])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getSource(SOURCE_IDS.highlight)) return; const focus = selected.find((feature) => !previousSelection.current.includes(feature.properties.id)); previousSelection.current = selected.map((feature) => feature.properties.id); selectFeatures(map, selected, focus, highlightStyle.animate) }, [selected, highlightStyle.animate])
  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded() && map.getLayer(LAYER_IDS.highlightLine)) updateHighlightStyle(map, highlightStyle) }, [highlightStyle])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getLayer(LAYER_IDS.gsiBase)) return; setBasemapMode(map, visibility.basemap, presentationLayerIds.current); const groups: [string[], boolean][] = [[[LAYER_IDS.roads],visibility.roads],[[LAYER_IDS.historicalRoads],visibility.historicalRoads],[[LAYER_IDS.places],visibility.places],[[LAYER_IDS.chomeFill,LAYER_IDS.chomeLine],visibility.chome]]; groups.forEach(([ids,on]) => ids.forEach((id) => map.setLayoutProperty(id,'visibility',on?'visible':'none'))) }, [visibility])
  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded() && map.getLayer(LAYER_IDS.diagnosticN13)) setDiagnosticVisibility(map, diagnosticVisibility) }, [diagnosticVisibility])
  return <div ref={container} className="map" aria-label="東京周辺の歴史地図" />
})
