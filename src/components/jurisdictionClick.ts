import type { MapLayerMouseEvent } from 'maplibre-gl'
import type { JurisdictionFeature } from '../data/jurisdictions'

export function handleJurisdictionClick(event:MapLayerMouseEvent,onSelect:(feature:JurisdictionFeature)=>void):void {
  const feature=event.features?.[0] as unknown as JurisdictionFeature|undefined
  if(feature)onSelect(feature)
}
