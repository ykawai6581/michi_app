import type { StoryTimeline } from './storyTimeline'

export const DEFAULT_PIXELS_PER_SECOND = 120
export const timeToX = (timeMs: number, pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND) => timeMs * pixelsPerSecond / 1000
export interface TimelineObject { stepIndex: number; startMs: number; durationMs: number; stack: number }
export function layoutTimeline(timeline: Pick<StoryTimeline, 'events'>): TimelineObject[] {
  const stacks = new Map<number, number>()
  return timeline.events.map(event => {
    const durationMs = event.endMs - event.startMs
    const stack = durationMs ? 0 : stacks.get(event.startMs) ?? 0
    if (!durationMs) stacks.set(event.startMs, stack + 1)
    return { stepIndex: event.stepIndex, startMs: event.startMs, durationMs, stack }
  })
}
