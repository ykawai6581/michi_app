import { describe, expect, it } from 'vitest'
import { effectiveDarkBasemap } from './darkBasemap'

describe('effective dark basemap', () => {
  it.each([
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ])('combines manual=%s and active=%s as %s', (manual, active, expected) => {
    expect(effectiveDarkBasemap(manual, active)).toBe(expected)
  })

  it('returns to the manual preference when selection is cleared', () => {
    expect(effectiveDarkBasemap(false, true)).toBe(true)
    expect(effectiveDarkBasemap(false, false)).toBe(false)
    expect(effectiveDarkBasemap(true, false)).toBe(true)
  })
})
