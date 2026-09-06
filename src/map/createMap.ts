import maplibregl from 'maplibre-gl'
import { TOKYO_CAMERA } from './config'

export const PRESENTATION_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright'

export function createMap(container: HTMLElement, pixelRatio: number): maplibregl.Map {
  return new maplibregl.Map({ container, style: PRESENTATION_STYLE_URL, ...TOKYO_CAMERA, pixelRatio, canvasContextAttributes: { preserveDrawingBuffer: true }, attributionControl: false, maxPitch: 60 })
}
