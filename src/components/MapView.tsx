import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { ProjectData } from '../data/project'
import type { EntityFeature, HighlightStyle, LayerVisibility, RoadSourceVisibility } from '../types/geo'
import { createMap } from '../map/createMap'
import { addDataLayers, getPresentationLayerIds, setBasemapMode, setProjectLayerVisibility } from '../map/layers'
import { selectFeatures, updateHighlightStyle } from '../map/highlight'
import { LAYER_IDS, SOURCE_IDS } from '../map/config'

export interface MapHandle { getMap: () => maplibregl.Map | null }
interface Props { project: ProjectData | null; selected: EntityFeature[]; highlightStyle: HighlightStyle; visibility: LayerVisibility; roadSources: RoadSourceVisibility; onReady: () => void }
export const MapView = forwardRef<MapHandle, Props>(function MapView({ project, selected, highlightStyle, visibility, roadSources, onReady }, ref) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<maplibregl.Map | null>(null); const presentationLayerIds = useRef<string[]>([]); const previousSelection = useRef<string[]>([])
  useImperativeHandle(ref, () => ({ getMap: () => mapRef.current }), [])
  useEffect(() => { if (!container.current || !project) return; const map = createMap(container.current); mapRef.current = map; map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-left'); map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right'); map.on('load', () => { presentationLayerIds.current = getPresentationLayerIds(map); addDataLayers(map, project); const inspect = [LAYER_IDS.modernRoads,LAYER_IDS.stations,LAYER_IDS.historicalRoads,LAYER_IDS.historicalPosts]; inspect.forEach((id) => map.on('click', id, (event) => { const p=event.features?.[0]?.properties; if(!p)return; const detail=[p.routeId,p.postId,p.historicalLabel,p.start&&p.end?`${p.start} → ${p.end}`:null,p.operator,p.network].filter(Boolean).join('<br>'); new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<strong>${p.name ?? '名称不明'}</strong>${detail?`<br>${detail}`:''}`).addTo(map) })); onReady() }); return () => { map.remove(); mapRef.current = null } }, [onReady, project])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getSource(SOURCE_IDS.highlight)) return; const focus = selected.find((feature) => !previousSelection.current.includes(feature.properties.id)); previousSelection.current = selected.map((feature) => feature.properties.id); selectFeatures(map, selected, roadSources, focus, highlightStyle.animate) }, [selected, roadSources, highlightStyle.animate])
  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded() && map.getLayer(LAYER_IDS.highlightLine)) updateHighlightStyle(map, highlightStyle) }, [highlightStyle])
  useEffect(() => { const map = mapRef.current; if (!map?.isStyleLoaded() || !map.getLayer(LAYER_IDS.gsiBase)) return; setBasemapMode(map, visibility.basemap, presentationLayerIds.current); setProjectLayerVisibility(map, visibility) }, [visibility])
  return <div ref={container} className="map" aria-label="東京周辺の歴史地図" />
})
