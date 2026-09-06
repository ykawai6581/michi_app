import maplibregl from 'maplibre-gl'
import { TOKYO_CAMERA } from './config'

export const PRESENTATION_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright'

const JAPANESE_NAME_TEXT_FIELD = ['coalesce', ['get', 'name:ja'], ['get', 'name']] as const

const expressionUses = (value: unknown, property: string): boolean => {
  if (!Array.isArray(value)) return false
  if ((value[0] === 'get' || value[0] === 'has') && value[1] === property) return true
  return value.some(item => expressionUses(item, property))
}

const forceJapanesePresentationLabels = (map: maplibregl.Map): void => {
  const layers = map.getStyle().layers ?? []
  layers.forEach(layer => {
    if (layer.type !== 'symbol' || !('source' in layer) || layer.source !== 'openmaptiles') return
    const textField = layer.layout?.['text-field']
    if (textField === undefined) return

    const isMultilingualName = expressionUses(textField, 'name:nonlatin')
      || expressionUses(textField, 'name:latin')
      || expressionUses(textField, 'name_en')
      || expressionUses(textField, 'name:en')
    if (!isMultilingualName) return

    map.setLayoutProperty(layer.id, 'text-field', JAPANESE_NAME_TEXT_FIELD as never)
  })
}

export function createMap(container: HTMLElement, pixelRatio: number): maplibregl.Map {
  const map = new maplibregl.Map({ container, style: PRESENTATION_STYLE_URL, ...TOKYO_CAMERA, pixelRatio, canvasContextAttributes: { preserveDrawingBuffer: true }, attributionControl: false, maxPitch: 60 })
  map.once('style.load', () => forceJapanesePresentationLabels(map))
  return map
}
