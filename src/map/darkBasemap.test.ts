import { describe, expect, it } from 'vitest'
import { effectiveDarkBasemap } from './darkBasemap'

describe('effective dark basemap', () => {
  it.each([
    ['auto', false, false, false],
    ['auto', false, true, true],
    ['auto', true, false, false],
    ['auto', true, true, true],
    ['manual', false, false, false],
    ['manual', false, true, false],
    ['manual', true, false, true],
    ['manual', true, true, true],
  ] as const)('%s mode with manual=%s and active=%s returns %s', (behavior, manual, active, expected) => {
    expect(effectiveDarkBasemap(behavior, manual, active)).toBe(expected)
  })
})
