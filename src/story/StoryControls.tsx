import type { Story } from './storyTypes'
import type { StoryPlayer, StoryPlayerState } from './storyPlayer'
const time = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
export function StoryControls({ story, player, state }: { story: Story; player: StoryPlayer; state: StoryPlayerState }) {
  return <section className="story-controls" aria-label="Story controller"><strong>Story: {story.displayName ?? story.id}</strong><div><button onClick={() => void player.restart()}>Restart</button><button onClick={() => void player.previous()}>Previous</button><button onClick={() => state.status === 'playing' ? player.pause() : void player.play()}>{state.status === 'playing' ? 'Pause' : 'Play'}</button><button onClick={() => void player.next()}>Next</button></div><small>{time(state.elapsedSeconds)} / {time(state.totalWaitDuration)} · Step {Math.min(state.currentStepIndex + 1, story.steps.length)} / {story.steps.length}</small><code>{state.currentStep?.label ?? state.currentStep?.action ?? state.status}</code>{state.error && <em>{state.error}</em>}</section>
}
