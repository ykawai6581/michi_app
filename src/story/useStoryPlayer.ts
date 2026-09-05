import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ProjectData } from '../data/project'
import { StoryPlayer } from './storyPlayer'
import type { Story, StoryAppOperations } from './storyTypes'

export function useStoryPlayer(story: Story | null, project: ProjectData | null, operations: StoryAppOperations | null, ready: boolean, autoplay: boolean) {
  const player = useMemo(() => story && project && operations ? new StoryPlayer(story, project, operations) : null, [story, project, operations])
  const fallback = { status: 'idle' as const, currentStepIndex: 0, currentStep: null, elapsedSeconds: 0, totalWaitDuration: 0, error: null }
  const state = useSyncExternalStore(player?.subscribe ?? (() => () => undefined), player?.getState ?? (() => fallback), player?.getState ?? (() => fallback))
  useEffect(() => () => player?.dispose(), [player])
  useEffect(() => { if (!player || !ready) return; window.__michiStory = { play: () => player.play(), pause: () => player.pause(), restart: () => player.restart(), next: () => player.next(), previous: () => player.previous(), getState: player.getState }; window.dispatchEvent(new CustomEvent('michi:story-ready')); if (autoplay) void player.play(); return () => { delete window.__michiStory } }, [autoplay, player, ready])
  return { player, state }
}
