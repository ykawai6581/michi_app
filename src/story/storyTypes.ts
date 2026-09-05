import type { BasemapMode, DarkModeBehavior, EntityFeature, LayerVisibility } from '../types/geo'
import type { JurisdictionSelection } from '../data/jurisdictions'

export const BASEMAP_MODES = ['presentation', 'rekichizu', 'gsi', 'white', 'transparent'] as const satisfies readonly BasemapMode[]
export const OVERLAY_KEYS = ['modernRoads', 'railways', 'stations', 'historicalRoads', 'historicalPosts', 'jurisdictions'] as const satisfies readonly (keyof LayerVisibility)[]
export const DARK_MODE_BEHAVIORS = ['auto', 'manual'] as const satisfies readonly DarkModeBehavior[]
export type OverlayKey = typeof OVERLAY_KEYS[number]
export interface CameraView { center: [number, number]; zoom: number; bearing: number; pitch: number }
export interface SetViewOptions { durationMs?: number; animateCamera?: boolean; signal?: AbortSignal }
export type StoryStep = ({ label?: string } & (
  | { action: 'show' | 'hide'; id: string }
  | { action: 'activate'; id: string; cameraDuration?: number }
  | { action: 'deactivate' }
  | { action: 'wait'; duration: number }
  | ({ action: 'setView'; duration?: number } & CameraView)
  | { action: 'setBasemap'; value: BasemapMode }
  | { action: 'setOverlay'; layer: OverlayKey; visible: boolean }
  | { action: 'setDarkMode'; value: DarkModeBehavior }
  | { action: 'setDarkBasemap'; value: boolean }
  | { action: 'selectJurisdiction'; id: string }
  | { action: 'clearJurisdiction' }
))
export interface Story { id: string; displayName?: string; project: string; steps: StoryStep[] }
export interface FeatureFocusOptions { durationMs?: number; animateCamera?: boolean }
export interface StoryAppSnapshot { selected: EntityFeature[]; activeFeature: EntityFeature | null; basemap: BasemapMode; layers: LayerVisibility; darkMode: DarkModeBehavior; jurisdiction: JurisdictionSelection; camera: CameraView }
export interface StoryAppOperations {
  snapshot(): StoryAppSnapshot
  restore(snapshot: StoryAppSnapshot, options?: FeatureFocusOptions): void | Promise<void>
  showFeature(feature: EntityFeature): void | Promise<void>
  hideFeature(feature: EntityFeature): void | Promise<void>
  activateFeature(feature: EntityFeature, options?: FeatureFocusOptions): void | Promise<void>
  deactivateFeature(): void | Promise<void>
  setBasemap(value: BasemapMode): void | Promise<void>
  setOverlayVisibility(layer: OverlayKey, visible: boolean): void | Promise<void>
  setDarkMode(value: DarkModeBehavior): void | Promise<void>
  setManualDarkBasemap(value: boolean): void | Promise<void>
  selectJurisdiction(id: string, options?: FeatureFocusOptions): void | Promise<void>
  clearJurisdiction(): void | Promise<void>
  getCurrentView(): CameraView
  setView(view: CameraView, options?: SetViewOptions): void | Promise<void>
}
