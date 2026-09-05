export const MAX_MAP_CANVAS_SIZE = 4096

export interface MapRenderPixelRatioOptions {
  logicalWidth: number
  logicalHeight: number
  displayedWidth: number
  displayedHeight: number
  devicePixelRatio: number
  maxCanvasSize?: number
}

export interface MapRenderPixelRatio {
  visualScale: number
  desiredPixelRatio: number
  effectivePixelRatio: number
}

/** Increase backing resolution without changing MapLibre's logical viewport. */
export function mapRenderPixelRatio({ logicalWidth, logicalHeight, displayedWidth, displayedHeight, devicePixelRatio, maxCanvasSize = MAX_MAP_CANVAS_SIZE }: MapRenderPixelRatioOptions): MapRenderPixelRatio {
  const validLogicalSize = logicalWidth > 0 && logicalHeight > 0
  const widthScale = validLogicalSize && displayedWidth > 0 ? displayedWidth / logicalWidth : 1
  const heightScale = validLogicalSize && displayedHeight > 0 ? displayedHeight / logicalHeight : 1
  const visualScale = Math.min(widthScale, heightScale)
  const desiredPixelRatio = (devicePixelRatio > 0 ? devicePixelRatio : 1) * visualScale
  const maxPixelRatio = validLogicalSize && maxCanvasSize > 0 ? Math.min(maxCanvasSize / logicalWidth, maxCanvasSize / logicalHeight) : 1
  const effectivePixelRatio = Math.max(1, Math.min(desiredPixelRatio, maxPixelRatio))
  return { visualScale, desiredPixelRatio, effectivePixelRatio }
}
