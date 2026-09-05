export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** The explicit easing used by both camera transitions and line drawing. */
export function easeOutCubic(value: number): number {
  const t = clamp01(value)
  return 1 - (1 - t) ** 3
}
