import { useEffect, useRef, useState } from 'react'

export const SCENE_REFERENCE_WIDTH = 960*0.8
export const SCENE_REFERENCE_HEIGHT = 540*0.8
export const SCENE_ASPECT_RATIO = SCENE_REFERENCE_WIDTH / SCENE_REFERENCE_HEIGHT
export const BASE_LINE_LABEL_SIZE_LARGE = 28
export const BASE_LINE_LABEL_SIZE_SMALL = 14

export interface SceneSize { width: number; height: number }

/** Keep MapLibre's logical viewport at or below the fixed 16:9 video frame. */
export function getEffectiveSceneSize(actualWidth: number, actualHeight: number): SceneSize {
  if (actualWidth <= 0 || actualHeight <= 0) return { width: SCENE_REFERENCE_WIDTH, height: SCENE_REFERENCE_HEIGHT }
  const width = Math.min(actualWidth, actualHeight * SCENE_ASPECT_RATIO, SCENE_REFERENCE_WIDTH)
  return { width, height: width / SCENE_ASPECT_RATIO }
}

export function calculatePresentationScale(sceneWidth: number): number {
  return sceneWidth > 0 ? sceneWidth / SCENE_REFERENCE_WIDTH : 1
}

export function annotationTextSize(annotationSize: 'normal' | 'large', presentationScale: number): number {
  const baseSize = annotationSize === 'large' ? BASE_LINE_LABEL_SIZE_LARGE : BASE_LINE_LABEL_SIZE_SMALL
  return baseSize * presentationScale
}

export function usePresentationScale<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [sceneSize, setSceneSize] = useState<SceneSize>({ width: SCENE_REFERENCE_WIDTH, height: SCENE_REFERENCE_HEIGHT })
  const [actualSize, setActualSize] = useState<SceneSize>({ width: SCENE_REFERENCE_WIDTH, height: SCENE_REFERENCE_HEIGHT })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (width: number, height: number) => {
      setActualSize({ width, height })
      setSceneSize(getEffectiveSceneSize(width, height))
    }
    const bounds = element.getBoundingClientRect()
    update(bounds.width, bounds.height)
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return {
    ref,
    sceneSize,
    presentationScale: calculatePresentationScale(sceneSize.width),
    visualScale: actualSize.width > 0 ? actualSize.width / sceneSize.width : 1,
  }
}
