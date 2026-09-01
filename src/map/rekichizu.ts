import type maplibregl from 'maplibre-gl'

export const REKICHIZU_STYLE_URL = 'https://mierune.github.io/rekichizu-style/styles/street/style.json'
export const REKICHIZU_PREFIX = 'basemap-rekichizu-'
export const REKICHIZU_ATTRIBUTION = '<a href="https://rekichizu.jp/" target="_blank" rel="noopener">れきちず / Rekichizu</a> · <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/" target="_blank" rel="noopener">CC BY-NC-ND 4.0</a>'

type RekichizuStyle = {
  sources: Record<string, maplibregl.SourceSpecification>
  layers: maplibregl.LayerSpecification[]
  sprite?: string
}

type StyleValue = string | unknown[]
const SPRITE_PROPERTIES = ['icon-image', 'fill-pattern', 'line-pattern', 'background-pattern'] as const

// URL encodes `{z}/{x}/{y}` placeholders, so restore braces required by MapLibre tile templates.
const absolute = (value: string, base: string) => new URL(value, base).toString().replaceAll('%7B', '{').replaceAll('%7D', '}')

function resolveSource(source: maplibregl.SourceSpecification): maplibregl.SourceSpecification {
  const resolved = structuredClone(source) as maplibregl.SourceSpecification & { url?: string; data?: string; tiles?: string[]; attribution?: string }
  if (resolved.url) resolved.url = absolute(resolved.url, REKICHIZU_STYLE_URL)
  if (typeof resolved.data === 'string') resolved.data = absolute(resolved.data, REKICHIZU_STYLE_URL)
  if (resolved.tiles) resolved.tiles = resolved.tiles.map((tile) => absolute(tile, REKICHIZU_STYLE_URL))
  resolved.attribution = [resolved.attribution, REKICHIZU_ATTRIBUTION].filter(Boolean).join(' · ')
  return resolved
}

async function addOfficialSprite(map: maplibregl.Map, spriteUrl?: string): Promise<void> {
  if (!spriteUrl) return
  const base = absolute(spriteUrl, REKICHIZU_STYLE_URL)
  const [metadataResponse, imageResponse] = await Promise.all([fetch(`${base}.json`), fetch(`${base}.png`)])
  if (!metadataResponse.ok || !imageResponse.ok) throw new Error('Rekichizu sprite could not be loaded')
  const metadata = await metadataResponse.json() as Record<string, { x:number; y:number; width:number; height:number; pixelRatio?:number }>
  const bitmap = await createImageBitmap(await imageResponse.blob())
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return
  context.drawImage(bitmap, 0, 0)
  Object.entries(metadata).forEach(([name, icon]) => {
    const namespacedName = `${REKICHIZU_PREFIX}${name}`
    if (!map.hasImage(namespacedName)) map.addImage(namespacedName, context.getImageData(icon.x, icon.y, icon.width, icon.height), { pixelRatio: icon.pixelRatio ?? 1 })
  })
  bitmap.close()
}

/** Adds the official style as namespaced basemap layers; project sources and layers are never replaced. */
export async function addRekichizuBasemap(map: maplibregl.Map, beforeId: string): Promise<string[]> {
  const response = await fetch(REKICHIZU_STYLE_URL)
  if (!response.ok) throw new Error(`Rekichizu style request failed (${response.status})`)
  const style = await response.json() as RekichizuStyle
  await addOfficialSprite(map, style.sprite)
  Object.entries(style.sources).forEach(([id, source]) => {
    const namespacedId = `${REKICHIZU_PREFIX}${id}`
    if (!map.getSource(namespacedId)) map.addSource(namespacedId, resolveSource(source))
  })
  const layerIds: string[] = []
  style.layers.forEach((officialLayer) => {
    const layer = structuredClone(officialLayer) as maplibregl.LayerSpecification & { source?: string; ref?: string; layout?: Record<string, unknown> }
    layer.id = `${REKICHIZU_PREFIX}${officialLayer.id}`
    if (layer.source) layer.source = `${REKICHIZU_PREFIX}${layer.source}`
    if (layer.ref) layer.ref = `${REKICHIZU_PREFIX}${layer.ref}`
    layer.layout = { ...layer.layout, visibility: 'none' }
    SPRITE_PROPERTIES.forEach((property) => {
      const container = property === 'icon-image' ? layer.layout : layer.paint as Record<string, unknown> | undefined
      const value = container?.[property] as StyleValue | undefined
      if (value !== undefined) container![property] = ['concat', REKICHIZU_PREFIX, value]
    })
    if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId)
    layerIds.push(layer.id)
  })
  return layerIds
}
