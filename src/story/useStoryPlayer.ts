import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ProjectData } from '../data/project'
import { StoryPlayer, type StoryPlayerState } from './storyPlayer'
import type { Story, StoryAppOperations } from './storyTypes'

const IDLE_STATE: StoryPlayerState = { status: 'idle', currentStepIndex: 0, currentStep: null, elapsedSeconds: 0, totalWaitDuration: 0, error: null }

export function useStoryPlayer(story: Story | null, project: ProjectData | null, operations: StoryAppOperations | null, ready: boolean, autoplay: boolean) {
  const operationsRef = useRef<StoryAppOperations | null>(operations)
  operationsRef.current = operations

  const stableOperations = useMemo<StoryAppOperations>(() => {
    const current = () => {
      const value = operationsRef.current
      if (!value) throw new Error('Story app operations are unavailable')
      return value
    }
    return {
      snapshot: () => current().snapshot(),
      restore: (snapshot, options) => current().restore(snapshot, options),
      showFeature: (feature) => current().showFeature(feature),
      hideFeature: (feature) => current().hideFeature(feature),
      activateFeature: (feature, options) => current().activateFeature(feature, options),
      deactivateFeature: () => current().deactivateFeature(),
      setBasemap: (value) => current().setBasemap(value),
      setOverlayVisibility: (layer, visible) => current().setOverlayVisibility(layer, visible),
      setDarkMode: (value) => current().setDarkMode(value),
      setManualDarkBasemap: (value) => current().setManualDarkBasemap(value),
      selectJurisdiction: (id, options) => current().selectJurisdiction(id, options),
      clearJurisdiction: () => current().clearJurisdiction(),
    }
  }, [])

  const player = useMemo(
    () => story && project && operations ? new StoryPlayer(story, project, stableOperations) : null,
    [project, stableOperations, story],
  )
  const state = useSyncExternalStore(player?.subscribe ?? (() => () => undefined), player?.getState ?? (() => IDLE_STATE), player?.getState ?? (() => IDLE_STATE))
  useEffect(() => () => player?.dispose(), [player])
  useEffect(() => {
    if (!player || !ready) return
    window.__michiStory = { play: () => player.play(), pause: () => player.pause(), restart: () => player.restart(), next: () => player.next(), previous: () => player.previous(), getState: player.getState }
    window.dispatchEvent(new CustomEvent('michi:story-ready'))
    if (autoplay) void player.play()
    return () => { delete window.__michiStory }
  }, [autoplay, player, ready])
  return { player, state }
}
