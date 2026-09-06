import type { JurisdictionSelection, JurisdictionStoryTarget } from '../data/jurisdictions'
import type { BasemapMode, DarkModeBehavior, EntityFeature, LayerVisibility } from '../types/geo'
import { easeOutCubic, clamp01 } from './storyEasing'
import { CLOUD_TRANSITION_DURATION_MS, cloudCoverProgress } from './cloudTransition'
import { findProjectFeatureById } from './storyFeatureResolver'
import type { ProjectData } from '../data/project'
import type { CameraView, Story, StoryAppSnapshot, StoryStep } from './storyTypes'

export const DEFAULT_CAMERA_DURATION_MS = 1200
export const FEATURE_REVEAL_DURATION_MS = 1250
export const BASEMAP_CROSSFADE_DURATION_MS = CLOUD_TRANSITION_DURATION_MS
export const BASEMAP_LABEL_SETTLE_DELAY_MS = 100
export const BASEMAP_LABEL_FADE_IN_MS = 300

export interface StoryStructuralState {
  visibleIds: string[]
  activeFeatureId: string | null
  basemap: BasemapMode
  layers: LayerVisibility
  darkMode: DarkModeBehavior
  jurisdiction: JurisdictionSelection | JurisdictionStoryTarget
}
export interface StoryTimelineEvent { stepIndex: number; startMs: number; endMs: number; step: StoryStep; state: StoryStructuralState }
export interface CameraSegment { startMs: number; endMs: number; from: CameraView; to: CameraView; stepIndex: number }
export interface RevealSegment { startMs: number; endMs: number; featureId: string }
export interface BasemapTransitionSegment { startMs: number; endMs: number; from: BasemapMode; to: BasemapMode; stepIndex: number }
export interface StoryTimeline { durationMs: number; baseline: StoryAppSnapshot; events: StoryTimelineEvent[]; cameraSegments: CameraSegment[]; revealSegments: RevealSegment[]; basemapTransitions: BasemapTransitionSegment[]; stepBoundariesMs: number[] }
export interface EvaluatedStoryState extends StoryStructuralState { timeMs: number; camera: CameraView; cameraMoving: boolean; basemapLabelOpacity: number; cloudCoverProgress: number; basemapTransition?: { from: BasemapMode; to: BasemapMode; progress: number }; lineReveal?: { featureId: string; progress: number } }
export type FeatureCameraResolver = (feature: EntityFeature, visibleFeatures: EntityFeature[], from: CameraView) => CameraView
export type JurisdictionCameraResolver = (target: JurisdictionStoryTarget, from: CameraView) => CameraView

const cloneCamera = (camera: CameraView): CameraView => ({ ...camera, center: [...camera.center] as [number, number] })
const structural = (snapshot: StoryAppSnapshot): StoryStructuralState => ({ visibleIds: snapshot.selected.map(feature => feature.properties.id), activeFeatureId: snapshot.activeFeature?.properties.id ?? null, basemap: snapshot.basemap, layers: { ...snapshot.layers }, darkMode: snapshot.darkMode, jurisdiction: snapshot.jurisdiction ? { ...snapshot.jurisdiction } : null })
const durationMs = (step: StoryStep): number => step.action === 'wait' ? step.duration * 1000 : step.action === 'setView' ? (step.duration === undefined ? DEFAULT_CAMERA_DURATION_MS : step.duration * 1000) : step.action === 'activate' || step.action === 'activateJurisdiction' ? (step.cameraDuration === undefined ? DEFAULT_CAMERA_DURATION_MS : step.cameraDuration * 1000) : 0

export function compileStoryTimeline(story: Story, project: ProjectData, baseline: StoryAppSnapshot, resolveCamera: FeatureCameraResolver, resolveJurisdictionCamera?: JurisdictionCameraResolver): StoryTimeline {
  let cursor = 0
  let camera = cloneCamera(baseline.camera)
  let state = structural(baseline)
  const events: StoryTimelineEvent[] = []
  const cameraSegments: CameraSegment[] = []
  const revealSegments: RevealSegment[] = []
  const basemapTransitions: BasemapTransitionSegment[] = []
  const stepBoundariesMs: number[] = []
  story.steps.forEach((step, stepIndex) => {
    const startMs = cursor
    stepBoundariesMs.push(startMs)
    const visible = () => state.visibleIds.map(id => findProjectFeatureById(project, id))
    switch (step.action) {
      case 'show': if (!state.visibleIds.includes(step.id)) state = { ...state, visibleIds: [...state.visibleIds, step.id] }; break
      case 'hide': state = { ...state, visibleIds: state.visibleIds.filter(id => id !== step.id), activeFeatureId: state.activeFeatureId === step.id ? null : state.activeFeatureId }; break
      case 'activate': {
        const feature = findProjectFeatureById(project, step.id)
        state = { ...state, activeFeatureId: step.id }
        const to = resolveCamera(feature, visible(), camera)
        const endMs = startMs + durationMs(step)
        cameraSegments.push({ startMs, endMs, from: cloneCamera(camera), to: cloneCamera(to), stepIndex })
        camera = cloneCamera(to)
        if (['LineString', 'MultiLineString', 'Polygon'].includes(feature.geometry.type)) revealSegments.push({ startMs, endMs: startMs + FEATURE_REVEAL_DURATION_MS, featureId: step.id })
        break
      }
      case 'deactivate': state = { ...state, activeFeatureId: null }; break
      case 'setView': {
        const to: CameraView = { center: [...step.center], zoom: step.zoom, bearing: step.bearing ?? 0, pitch: step.pitch ?? 0 }
        const endMs = startMs + durationMs(step)
        cameraSegments.push({ startMs, endMs, from: cloneCamera(camera), to, stepIndex })
        camera = cloneCamera(to); break
      }
      case 'setBasemap': {
        const from = state.basemap
        state = { ...state, basemap: step.value, layers: { ...state.layers, basemap: step.value } }
        if (from !== step.value) basemapTransitions.push({ startMs, endMs: startMs + BASEMAP_CROSSFADE_DURATION_MS, from, to: step.value, stepIndex })
        break
      }
      case 'setOverlay': state = { ...state, layers: { ...state.layers, [step.layer]: step.visible } }; break
      case 'setDarkMode': state = { ...state, darkMode: step.value }; break
      case 'setDarkBasemap': state = { ...state, layers: { ...state.layers, darkBasemap: step.value } }; break
      case 'selectJurisdiction': state = { ...state, jurisdiction: { level: 'municipality', value: step.id } }; break
      case 'showJurisdiction': state = { ...state, jurisdiction: { ...step }, layers: { ...state.layers, jurisdictions: true } }; break
      case 'hideJurisdiction': {
        const selected=state.jurisdiction
        if(selected&&'snapshotDate' in selected&&selected.name===step.name&&selected.level===step.level&&selected.snapshotDate===step.snapshotDate)state={...state,jurisdiction:null}
        break
      }
      case 'activateJurisdiction': {
        if(!resolveJurisdictionCamera)throw new Error('Jurisdiction camera resolver is unavailable')
        state={...state,jurisdiction:{...step},layers:{...state.layers,jurisdictions:true}}
        const to=resolveJurisdictionCamera(step,camera); const endMs=startMs+durationMs(step)
        cameraSegments.push({startMs,endMs,from:cloneCamera(camera),to:cloneCamera(to),stepIndex}); camera=cloneCamera(to); break
      }
      case 'clearJurisdiction': state = { ...state, jurisdiction: null }; break
      case 'wait': break
    }
    cursor += durationMs(step)
    events.push({ stepIndex, startMs, endMs: cursor, step, state: { ...state, visibleIds: [...state.visibleIds], layers: { ...state.layers }, jurisdiction: state.jurisdiction ? { ...state.jurisdiction } : null } })
  })
  return { durationMs: cursor, baseline: structuredClone(baseline), events, cameraSegments, revealSegments, basemapTransitions, stepBoundariesMs }
}

export function interpolateCamera(from: CameraView, to: CameraView, progress: number): CameraView {
  const t = easeOutCubic(progress)
  const bearingDelta = ((to.bearing - from.bearing + 540) % 360) - 180
  return { center: [from.center[0] + (to.center[0] - from.center[0]) * t, from.center[1] + (to.center[1] - from.center[1]) * t], zoom: from.zoom + (to.zoom - from.zoom) * t, bearing: from.bearing + bearingDelta * t, pitch: from.pitch + (to.pitch - from.pitch) * t }
}

export function evaluateTimeline(timeline: StoryTimeline, requestedMs: number): EvaluatedStoryState {
  const timeMs = Number.isFinite(requestedMs) ? Math.min(timeline.durationMs, Math.max(0, requestedMs)) : 0
  const event = timeline.events.filter(item => item.startMs <= timeMs).at(-1)
  const state = event?.state ?? structural(timeline.baseline)
  let camera = cloneCamera(timeline.baseline.camera)
  for (const segment of timeline.cameraSegments) {
    if (timeMs < segment.startMs) break
    camera = timeMs >= segment.endMs ? cloneCamera(segment.to) : interpolateCamera(segment.from, segment.to, (timeMs - segment.startMs) / (segment.endMs - segment.startMs))
    if (timeMs < segment.endMs) break
  }
  const reveal = [...timeline.revealSegments].reverse().find(segment => segment.startMs <= timeMs && state.activeFeatureId === segment.featureId)
  const activeCamera = timeline.cameraSegments.find(segment => segment.startMs <= timeMs && timeMs < segment.endMs)
  const previousCamera = [...timeline.cameraSegments].reverse().find(segment => segment.endMs <= timeMs)
  const sinceCameraEnd = previousCamera ? timeMs - previousCamera.endMs : Infinity
  const basemapLabelOpacity = activeCamera ? 0 : previousCamera && sinceCameraEnd < BASEMAP_LABEL_SETTLE_DELAY_MS ? 0 : previousCamera && sinceCameraEnd < BASEMAP_LABEL_SETTLE_DELAY_MS + BASEMAP_LABEL_FADE_IN_MS
    ? easeOutCubic((sinceCameraEnd - BASEMAP_LABEL_SETTLE_DELAY_MS) / BASEMAP_LABEL_FADE_IN_MS) : 1
  const transition = [...timeline.basemapTransitions].reverse().find(segment => segment.startMs <= timeMs && timeMs < segment.endMs)
  const transitionRaw = transition ? clamp01((timeMs - transition.startMs) / BASEMAP_CROSSFADE_DURATION_MS) : 0
  // Keep the actual basemap swap concentrated near full cloud cover so tile/style
  // differences are masked by the decorative wipe rather than exposed mid-screen.
  const basemapProgress = transition ? easeOutCubic(clamp01((transitionRaw - 0.38) / 0.24)) : 0
  return { ...state, visibleIds: [...state.visibleIds], layers: { ...state.layers }, jurisdiction: state.jurisdiction ? { ...state.jurisdiction } : null, timeMs, camera, cameraMoving: Boolean(activeCamera), basemapLabelOpacity, cloudCoverProgress: transition ? cloudCoverProgress(transitionRaw) : 0, basemapTransition: transition ? { from: transition.from, to: transition.to, progress: basemapProgress } : undefined, lineReveal: reveal ? { featureId: reveal.featureId, progress: easeOutCubic(clamp01((timeMs - reveal.startMs) / FEATURE_REVEAL_DURATION_MS)) } : undefined }
}
