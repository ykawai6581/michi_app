import type { StoryPlayer } from './storyPlayer'
import type { StoryStep } from './storyTypes'
import { storyStepDurationMs } from './storyTimeline'

export const authoredStepDuration = (step: StoryStep): number | null => {
  const duration = storyStepDurationMs(step)
  return duration > 0 ? duration / 1000 : null
}
export async function seekStoryPreview(player: Pick<StoryPlayer,'pause'|'seek'>, seconds: number) { player.pause(); await player.seek(seconds) }
