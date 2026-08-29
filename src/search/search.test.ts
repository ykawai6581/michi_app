import { describe, expect, it } from 'vitest'
import { entities } from '../data/sample'
import { normalizeJapanese } from './normalizeJapanese'
import { searchEntities } from './search'
import roadIndex from '../../public/search/roads.json'
import roadRegistry from '../../data/roads/registry.json'
import type { EntityFeature } from '../types/geo'

describe('Japanese search', () => {
  it('normalizes width, whitespace, and chome numerals', () => expect(normalizeJapanese(' 新宿１丁目 ')).toBe(normalizeJapanese('新宿一丁目')))
  it('resolves historical aliases', () => expect(searchEntities(entities, '甲州街道').map((f) => f.properties.id)).toContain('R003-sample'))
  it('keeps modern and historical road entities distinct', () => expect(searchEntities(entities, '甲州街道').filter((f) => ['road','historical-road'].includes(f.properties.type))).toHaveLength(2))
  it.each(['国道20号', '国道20', '20号'])('resolves %s to the canonical Route 20 entity', (query) => {
    const road = roadIndex.find((entry) => entry.id === 'jp-national-20')!
    const canonical = { type: 'Feature', properties: { id: road.id, name: road.name, aliases: road.aliases, type: 'road' }, geometry: { type: 'MultiLineString', coordinates: [] } } as EntityFeature
    expect(searchEntities([canonical], query).map((feature) => feature.properties.id)).toEqual(['jp-national-20'])
  })
  it('keeps the named Koshu Kaido entity separate from statutory Route 20', () => {
    const entries = roadRegistry.roads.filter((entry) => ['jp-national-20', 'tokyo-named-koshu-kaido'].includes(entry.id))
    const roads = entries.map((entry) => ({ type: 'Feature', properties: {
      id: entry.id, name: entry.displayName, aliases: entry.aliases, type: 'road',
    }, geometry: { type: 'MultiLineString', coordinates: [] } })) as EntityFeature[]
    expect(searchEntities(roads, '国道20号').map((road) => road.properties.id)).toEqual(['jp-national-20'])
    expect(searchEntities(roads, '甲州街道').map((road) => road.properties.id)).toEqual(['tokyo-named-koshu-kaido'])
  })
})
