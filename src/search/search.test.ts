import { describe, expect, it } from 'vitest'
import { entities } from '../data/sample'
import { normalizeJapanese } from './normalizeJapanese'
import { searchEntities } from './search'

describe('Japanese search', () => {
  it('normalizes width, whitespace, and chome numerals', () => expect(normalizeJapanese(' 新宿１丁目 ')).toBe(normalizeJapanese('新宿一丁目')))
  it('resolves historical aliases', () => expect(searchEntities(entities, '甲州街道').map((f) => f.properties.id)).toContain('R003-sample'))
  it('keeps modern and historical road entities distinct', () => expect(searchEntities(entities, '甲州街道').filter((f) => ['road','historical-road'].includes(f.properties.type))).toHaveLength(2))
})
