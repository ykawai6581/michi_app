import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import { TOKYO_CAMERA } from './config'

const whiteStyle: StyleSpecification = { version: 8, name: 'Michi White', sources: {}, layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#f4f2ec' } }] }

export function createMap(container: HTMLElement): maplibregl.Map {
  return new maplibregl.Map({ container, style: whiteStyle, ...TOKYO_CAMERA, preserveDrawingBuffer: true, attributionControl: false, maxPitch: 60 })
}
