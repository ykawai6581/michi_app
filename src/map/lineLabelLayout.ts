export const POST_FOCUS_ZOOM_OUT = 0.06
export const POST_FOCUS_ZOOM_DURATION_MS = 120
export const LABEL_LAYOUT_DELAY_MS = 150
export const LABEL_FADE_DURATION_MS = 300

type FocusCameraPhase = 'idle' | 'primary-focus' | 'post-focus-adjustment'

export interface LineLabelLayoutMap {
  getZoom(): number
  easeTo(options: { zoom: number; duration: number }): void
  getLayer(id: string): unknown
  getSource(id: string): unknown
  setPaintProperty(layer: string, property: string, value: unknown): void
}

export interface LineLabelLayoutController {
  beginFocus(): void
  onMoveEnd(): void
  onZoomEnd(): void
  schedule(): void
  dispose(): void
}

export function createLineLabelLayoutController(
  map: LineLabelLayoutMap,
  layerId: string,
  sourceId: string,
  layout: () => void,
  reducedMotion = false,
): LineLabelLayoutController {
  let phase: FocusCameraPhase = 'idle'
  let timer: ReturnType<typeof setTimeout> | undefined
  let fadeFrame: number | undefined
  let generation = 0

  const cancelPending = () => {
    generation += 1
    if (timer !== undefined) clearTimeout(timer)
    if (fadeFrame !== undefined) cancelAnimationFrame(fadeFrame)
    timer = undefined
    fadeFrame = undefined
  }
  const hide = () => {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, 'text-opacity-transition', { duration: 0, delay: 0 })
      map.setPaintProperty(layerId, 'text-opacity', 0)
    }
  }
  const schedule = () => {
    cancelPending()
    hide()
    const scheduledGeneration = generation
    timer = setTimeout(() => {
      timer = undefined
      if (scheduledGeneration !== generation || !map.getLayer(layerId) || !map.getSource(sourceId)) return
      map.setPaintProperty(layerId, 'text-opacity-transition', { duration: reducedMotion ? 0 : LABEL_FADE_DURATION_MS, delay: 0 })
      layout()
      fadeFrame = requestAnimationFrame(() => {
        fadeFrame = undefined
        if (scheduledGeneration === generation && map.getLayer(layerId)) map.setPaintProperty(layerId, 'text-opacity', 1)
      })
    }, LABEL_LAYOUT_DELAY_MS)
  }
  return {
    beginFocus() {
      cancelPending()
      hide()
      phase = 'primary-focus'
    },
    onMoveEnd() {
      if (phase === 'primary-focus') {
        phase = 'post-focus-adjustment'
        map.easeTo({ zoom: map.getZoom() - POST_FOCUS_ZOOM_OUT, duration: reducedMotion ? 0 : POST_FOCUS_ZOOM_DURATION_MS })
        return
      }
      if (phase === 'post-focus-adjustment') {
        phase = 'idle'
        schedule()
        return
      }
      schedule()
    },
    onZoomEnd() {
      if (phase === 'idle') schedule()
    },
    schedule,
    dispose() {
      cancelPending()
      phase = 'idle'
    },
  }
}
