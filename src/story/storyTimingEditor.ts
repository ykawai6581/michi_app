import type { StoryPlayer } from './storyPlayer'
import type { StoryStep } from './storyTypes'
import { DEFAULT_CAMERA_DURATION_MS } from './storyTimeline'

export const authoredStepDuration = (step: StoryStep): number | null => step.action === 'wait' ? step.duration : step.action === 'setView' ? step.duration ?? DEFAULT_CAMERA_DURATION_MS / 1000 : step.action === 'activate' ? step.cameraDuration ?? DEFAULT_CAMERA_DURATION_MS / 1000 : null
export async function seekStoryPreview(player: Pick<StoryPlayer,'pause'|'seek'>, seconds: number) { player.pause(); await player.seek(seconds) }
