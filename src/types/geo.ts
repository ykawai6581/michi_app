import type { Feature, Geometry } from 'geojson'

export type MapEntityType = 'road' | 'historical-road' | 'place' | 'historical-place' | 'chome' | 'station' | 'railway' | 'river' | 'water' | 'terrain-feature' | 'custom'
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'
export type BasemapMode = 'presentation' | 'dark' | 'gsi' | 'white' | 'transparent'

export interface EntityProperties {
  id: string
  name: string
  type: MapEntityType
  aliases?: string[]
  period?: string
  source?: string[]
  source_url?: string[]
  license?: string
  checked?: string
  confidence?: Confidence
  note?: string
  relatedEntities?: string[]
}

export type EntityFeature = Feature<Geometry, EntityProperties>
export interface SceneItem { feature: EntityFeature; visible: boolean }
export interface HighlightStyle { roadColor: string; locationColor: string; regionColor: string; width: number; opacity: number; glow: boolean; animate: boolean; annotationSize: 'normal' | 'large' }
export interface LayerVisibility { basemap: BasemapMode; roads: boolean; historicalRoads: boolean; places: boolean; chome: boolean }
export interface CameraState { center: [number, number]; zoom: number; bearing: number; pitch: number }
export interface SavedView { id: string; name: string; camera: CameraState }
