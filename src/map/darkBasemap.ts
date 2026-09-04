import type { DarkModeBehavior } from '../types/geo'

export function effectiveDarkBasemap(
  behavior: DarkModeBehavior,
  manualDarkBasemap: boolean,
  hasActiveFeature: boolean,
): boolean {
  return behavior === 'auto' ? hasActiveFeature : manualDarkBasemap
}
