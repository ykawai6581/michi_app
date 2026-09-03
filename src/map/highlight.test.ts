import { describe, expect, it, vi } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { roadGlowFeatures, splitRoadSourceFeatures, updateHighlightStyle } from './highlight'
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

describe('active road glow', () => {
  const roads = ['A','B','C'].map((id) => ({ ...road, properties: { ...road.properties, id } }))

  it('marks only the active road while retaining every visible road', () => {
    const result = roadGlowFeatures(roads, roads[1])
    expect(result).toHaveLength(3)
    expect(result.map((feature) => feature.properties.activeRoadGlow)).toEqual([false,true,false])
  })

  it('transfers glow and removes it for null or non-road active features', () => {
    expect(roadGlowFeatures(roads,roads[2]).map(feature=>feature.properties.activeRoadGlow)).toEqual([false,false,true])
    expect(roadGlowFeatures(roads,null).every(feature=>feature.properties.activeRoadGlow===false)).toBe(true)
    const region={...roads[0],properties:{...roads[0].properties,type:'jurisdiction' as const}}
    expect(roadGlowFeatures(roads,region).every(feature=>feature.properties.activeRoadGlow===false)).toBe(true)
  })
})

describe('generic region highlight styling', () => {
  const style = (regionColor: string, glow: boolean) => ({ roadColor:'#FF7B00', locationColor:'#64c2f2', regionColor, width:7, opacity:1, glow, animate:true, annotationSize:'large' as const })
  const mapMock = () => ({ setPaintProperty: vi.fn(), setLayoutProperty: vi.fn() })

  it('uses regionColor for fill, outline, and glow', () => {
    const map = mapMock()
    updateHighlightStyle(map as never, style('#C84646', true))
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightFill, 'fill-color', '#C84646')
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLine, 'line-color', ['match', ['geometry-type'], 'LineString', '#FF7B00', '#C84646'])
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineGlow, 'line-color', ['match', ['geometry-type'], 'LineString', '#fff', '#C84646'])
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineGlow, 'line-opacity', 0.65)
  })

  it('hides the glow without hiding the region highlight', () => {
    const map = mapMock()
    updateHighlightStyle(map as never, style('#C84646', false))
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineGlow, 'line-opacity', 0)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightFill, 'fill-opacity', 0.38)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLine, 'line-opacity', 1)
  })

  it('updates the region glow when regionColor changes', () => {
    const map = mapMock()
    updateHighlightStyle(map as never, style('#C84646', true))
    updateHighlightStyle(map as never, style('#123456', true))
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(LAYER_IDS.highlightLabels, 'text-color', ['match', ['geometry-type'], 'Polygon', '#123456', '#64c2f2'])
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.highlightLineGlow, 'line-color', ['match', ['geometry-type'], 'LineString', '#fff', '#123456'])
  })
})
