import { useEffect, useRef, useState } from 'react'

export const REFERENCE_MAP_WIDTH = 980
export const BASE_LINE_LABEL_SIZE_LARGE = 28
export const BASE_LINE_LABEL_SIZE_SMALL = 14

export function calculatePresentationScale(mapCanvasWidth: number): number {
  return mapCanvasWidth > 0 ? mapCanvasWidth / REFERENCE_MAP_WIDTH : 1
}

export function annotationTextSize(annotationSize: 'normal' | 'large', presentationScale: number): number {
  const baseSize = annotationSize === 'large' ? BASE_LINE_LABEL_SIZE_LARGE : BASE_LINE_LABEL_SIZE_SMALL
  return baseSize * presentationScale
}

export function usePresentationScale<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [presentationScale, setPresentationScale] = useState(1)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (width: number) => setPresentationScale(calculatePresentationScale(width))
    update(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, presentationScale }
}
