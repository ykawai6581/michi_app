import { describe, expect, it, vi } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { FALLBACK_RAIL_COLOR, RETAINED_LINE_COLOR, lineColorExpression, markActiveLine, sceneLineColorExpression, splitRoadSourceFeatures, updateHighlightStyle } from './highlight'
import { LAYER_IDS } from './config'

const road = { type: 'Feature', properties: { id: 'road', name: 'Road', type: 'road', roadSourceGeometries: { n13: { type: 'LineString', coordinates: [[0, 0], [1, 0]] }, osm: { type: 'LineString', coordinates: [[0, 1], [1, 1]] } } }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } } as EntityFeature

describe('canonical road source visibility', () => {
  it.each([
    [{ n13: true, osm: false }, 1, 0],
    [{ n13: false, osm: true }, 0, 1],
    [{ n13: true, osm: true }, 1, 1],
    [{ n13: false, osm: false }, 0, 0],
  ] as const)('splits N13=%s and OSM source features independently', (visibility, primary, osm) => {
    const result = splitRoadSourceFeatures([road], visibility)
    expect([result.primary.length, result.osm.length]).toEqual([primary, osm])
  })
})

describe('active road and railway emphasis', () => {
  const roads = ['A','B','C'].map((id) => ({ ...road, properties: { ...road.properties, id } }))

  it('marks only the active road while retaining every visible road', () => {
    const result = markActiveLine(roads, roads[1])
    expect(result).toHaveLength(3)
    expect(result.map((feature) => feature.properties.activeLine)).toEqual([false,true,false])
  })

  it('marks every visible road selected in Multi mode', () => {
    expect(markActiveLine(roads, roads[1], 'multi').map(feature=>feature.properties.sceneLineState)).toEqual(['selected','selected','selected'])
  })

  it('retains all labels while switching the active Single-mode road', () => {
    expect(markActiveLine(roads,roads[1],'single').map(feature=>feature.properties.sceneLineState)).toEqual(['retained','active','retained'])
    expect(markActiveLine(roads,roads[2],'single').map(feature=>feature.properties.sceneLineState)).toEqual(['retained','retained','active'])
  })

  it('transfers emphasis and removes it for null or non-road active features', () => {
    expect(markActiveLine(roads,roads[2]).map(feature=>feature.properties.activeLine)).toEqual([false,false,true])
    expect(markActiveLine(roads,null).every(feature=>feature.properties.activeLine===false)).toBe(true)
    const region={...roads[0],properties:{...roads[0].properties,type:'jurisdiction' as const}}
    expect(markActiveLine(roads,region).every(feature=>feature.properties.activeLine===false)).toBe(true)
  })

  it('transfers the emphasis from a road to a railway',()=>{const rails=roads.map(feature=>({...feature,properties:{...feature.properties,type:'railway' as const,railColor:'#123456'}}));expect(markActiveLine(rails,rails[1]).map(feature=>feature.properties.activeLine)).toEqual([false,true,false]);expect(markActiveLine([...roads,...rails],rails[2]).filter(feature=>feature.properties.type==='road').every(feature=>!feature.properties.activeLine)).toBe(true)})

  it('uses feature type and the catalog fallback in the shared line expression',()=>expect(lineColorExpression('#FF7B00')).toEqual(['case',['==',['get','type'],'railway'],['coalesce',['get','railColor'],FALLBACK_RAIL_COLOR],'#FF7B00']))

  it('uses one state-aware expression for retained lines and their labels',()=>expect(sceneLineColorExpression('#FF7B00')).toEqual(['case',['==',['get','sceneLineState'],'retained'],RETAINED_LINE_COLOR,lineColorExpression('#FF7B00')]))
})

describe('highlight styling updates', () => {
  const style = (regionColor: string, glow: boolean) => ({ roadColor:'#FF7B00', locationColor:'#64c2f2', regionColor, width:7, opacity:1, glow, animate:true, annotationSize:'large' as const })
  const mapMock = () => ({ setPaintProperty: vi.fn(), setLayoutProperty: vi.fn() })

  it('updates active core colors and all three active widths independently of glow', () => {
    const map = mapMock()
    updateHighlightStyle(map as never, style('#C84646', false))
    const coreWidth = ['*', 7, ['coalesce', ['get', 'illustrationWidthScale'], 1]]
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineActive, 'line-color', lineColorExpression('#FF7B00'))
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineActive, 'line-width', coreWidth)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineOutline, 'line-width', ['+', coreWidth, 6])
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineShadow, 'line-width', ['+', coreWidth, 14])
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightRegionGlow, 'line-opacity', 0)
  })

  it('keeps glow as polygon and point presentation state', () => {
    const map = mapMock()
    updateHighlightStyle(map as never, style('#123456', true))
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightRegionGlow, 'line-color', '#123456')
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightRegionGlow, 'line-opacity', 0.65)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightPointGlow, 'circle-opacity', 0.24)
  })

  it.each([
    ['large', 1, 28, 3],
    ['large', 1.5, 42, 4.5],
    ['normal', 1, 14, 3],
    ['normal', 1.5, 21, 4.5],
  ] as const)('scales %s annotation text and halos at scale %s', (annotationSize, scale, textSize, haloWidth) => {
    const map = mapMock()
    updateHighlightStyle(map as never, { ...style('#C84646', true), annotationSize }, scale)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineLabels, 'text-size', textSize)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLabels, 'text-size', textSize)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineLabels, 'text-halo-width', haloWidth)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLabels, 'text-halo-width', haloWidth)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineLabels, 'text-color', sceneLineColorExpression('#FF7B00'))
  })
})
