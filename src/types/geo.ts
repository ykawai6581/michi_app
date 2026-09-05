import type { Feature, Geometry } from 'geojson'

export type MapEntityType = 'road' | 'historical-road' | 'place' | 'historical-place' | 'chome' | 'station' | 'railway' | 'jurisdiction' | 'river' | 'water' | 'terrain-feature' | 'custom'
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'
export type BasemapMode = 'presentation' | 'rekichizu' | 'gsi' | 'white' | 'transparent'
export type DarkModeBehavior = 'auto' | 'manual'
export type SelectionMode = 'multi' | 'single'
export type SceneLineState = 'active' | 'selected' | 'retained'
export interface RoadSourceGeometries { n13: Geometry; osm: Geometry }

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
  confidence?: Confidence | number
  note?: string
  relatedEntities?: string[]
  illustrationWidthScale?: number
  activeLine?: boolean
  sceneLineState?: SceneLineState
  roadSourceGeometries?: RoadSourceGeometries
  osm_id?: number
  ref?: string
  highway?: string
  railGroupId?: string
  railDisplayName?: string
  railColor?: string
  railColorId?: string
  railRouteId?: string
  railRouteIds?: string[]
  railCanonicalId?: string
  memberWayIds?: string[]
  osm_way_id?: string | number
  routeId?: string
  postId?: string
  historicalLabel?: string
  start?: string
  end?: string
  operator?: string
  network?: string
  wikidata?: string
  'name:ja'?: string
  'name:en'?: string
}

export type EntityFeature = Feature<Geometry, EntityProperties>
export interface SceneItem { feature: EntityFeature; visible: boolean; projectBacked?: boolean }
export interface HighlightStyle { roadColor: string; locationColor: string; regionColor: string; width: number; opacity: number; glow: boolean; animate: boolean; annotationSize: 'normal' | 'large' }
export interface LayerVisibility { basemap: BasemapMode; darkBasemap: boolean; modernRoads: boolean; railways: boolean; stations: boolean; historicalRoads: boolean; historicalPosts: boolean; jurisdictions: boolean }
export interface PointOverlayStyle { stations: { radius: number }; historicalPosts: { radius: number } }
export interface RoadSourceVisibility { n13: boolean; osm: boolean }
export interface CameraState { center: [number, number]; zoom: number; bearing: number; pitch: number }
export interface SavedView { id: string; name: string; camera: CameraState }
