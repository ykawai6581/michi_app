import type { ProjectData } from '../data/project'
import type { Story, StoryAppOperations, StoryStep } from './storyTypes'
import { compileStoryTimeline, evaluateTimeline, type StoryTimeline } from './storyTimeline'

export type StoryPlayerStatus = 'idle' | 'playing' | 'paused' | 'complete' | 'error'
export interface StoryPlayerState { status: StoryPlayerStatus; currentStepIndex: number; currentStep: StoryStep | null; elapsedSeconds: number; totalWaitDuration: number; playbackRate: number; error: string | null }
export interface StoryClock { now(): number; schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void }
const systemClock: StoryClock = { now: () => performance.now(), schedule: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle as number) }
const CUE_EPSILON_MS = 0.01

export class StoryPlayer {
  readonly timeline: StoryTimeline
  private listeners = new Set<() => void>()
  private timer: unknown
  private generation = 0
  private playStartedAt = 0
  private playStartedStoryMs = 0
  private playbackRate = 1
  private state: StoryPlayerState
  private snapshot: StoryPlayerState

  constructor(private story: Story, project: ProjectData, private operations: StoryAppOperations, private clock: StoryClock = systemClock) {
    const baseline = operations.snapshot()
    this.timeline = compileStoryTimeline(story, project, baseline, operations.resolveFeatureCameraTarget ?? ((_feature, _visible, from) => from))
    this.state = { status: 'paused', currentStepIndex: 0, currentStep: story.steps[0] ?? null, elapsedSeconds: 0, totalWaitDuration: this.timeline.durationMs / 1000, playbackRate: this.playbackRate, error: null }
    this.snapshot = { ...this.state }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getState = () => this.snapshot
  getDuration = () => this.timeline.durationMs / 1000
  getTime = () => this.state.elapsedSeconds
  getPlaybackRate = () => this.playbackRate
  waitForRender = () => this.operations.waitForRender?.() ?? Promise.resolve()
  private emit() { this.state.currentStep = this.story.steps[this.state.currentStepIndex] ?? null; this.snapshot = { ...this.state }; this.listeners.forEach(listener => listener()) }
  private indexAt(timeMs: number) { let index = 0; this.timeline.events.forEach(event => { if (event.startMs <= timeMs) index = event.stepIndex }); return index }
  private cueTimes() { return [...new Set([...this.timeline.stepBoundariesMs, this.timeline.durationMs])].sort((a, b) => a - b) }
  private nextCueTime(fromMs: number) { return this.cueTimes().find(time => time > fromMs + CUE_EPSILON_MS) ?? this.timeline.durationMs }
  private previousCueTime(fromMs: number) { const times = this.cueTimes(); for (let index = times.length - 1; index >= 0; index -= 1) if (times[index] < fromMs - CUE_EPSILON_MS) return times[index]; return 0 }
  private stopClock() { if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined; this.generation += 1 }
  private setError(error: unknown) { this.stopClock(); this.state.status = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.emit(); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('michi:story-error', { detail: this.state.error })) }
  setPlaybackRate(rate: number) {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Story playback rate must be a positive finite number')
    if (this.state.status === 'playing') {
      const now = this.clock.now()
      this.playStartedStoryMs = Math.min(this.timeline.durationMs, this.playStartedStoryMs + (now - this.playStartedAt) * this.playbackRate)
      this.playStartedAt = now
      void this.seek(this.playStartedStoryMs / 1000)
    }
    this.playbackRate = rate
    this.state.playbackRate = rate
    this.emit()
  }

  async seek(seconds: number) {
    if (!Number.isFinite(seconds)) throw new Error('Story seek time must be a finite number')
    const frame = evaluateTimeline(this.timeline, seconds * 1000)
    if (!this.operations.applyStoryFrame) throw new Error('Deterministic Story frame application is unavailable')
    await this.operations.applyStoryFrame(frame)
    this.state.elapsedSeconds = frame.timeMs / 1000
    this.state.currentStepIndex = this.indexAt(frame.timeMs)
    this.state.error = null
    if (frame.timeMs >= this.timeline.durationMs && this.timeline.durationMs > 0) this.state.status = 'complete'
    else if (this.state.status !== 'playing') this.state.status = 'paused'
    this.emit()
  }
  async play() {
    if (this.state.status === 'playing') return
    if (this.state.status === 'error') return
    if (this.state.elapsedSeconds * 1000 >= this.timeline.durationMs) await this.seek(0)
    this.state.status = 'playing'; this.emit()
    this.playStartedAt = this.clock.now(); this.playStartedStoryMs = this.state.elapsedSeconds * 1000
    const generation = ++this.generation
    return new Promise<void>((resolve) => {
      const tick = async () => {
        if (generation !== this.generation || this.state.status !== 'playing') { resolve(); return }
        const target = Math.min(this.timeline.durationMs, this.playStartedStoryMs + (this.clock.now() - this.playStartedAt) * this.playbackRate)
        try { await this.seek(target / 1000) } catch (error) { this.setError(error); resolve(); return }
        if (target >= this.timeline.durationMs) { this.timer = undefined; this.state.status = 'complete'; this.emit(); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('michi:story-complete')); resolve(); return }
        this.state.status = 'playing'; this.timer = this.clock.schedule(() => { void tick() }, 16)
      }
      void tick()
    })
  }
  pause() { if (this.state.status !== 'playing') return; this.stopClock(); this.state.status = 'paused'; this.emit() }
  async restart() { this.stopClock(); this.state.status = 'paused'; await this.seek(0) }
  async next() { this.pause(); await this.seek(this.nextCueTime(this.state.elapsedSeconds * 1000) / 1000) }
  async previous() { this.pause(); await this.seek(this.previousCueTime(this.state.elapsedSeconds * 1000) / 1000) }
  async replayToStep(index: number) { this.pause(); await this.seek((this.timeline.stepBoundariesMs[Math.max(0, Math.min(index, this.story.steps.length - 1))] ?? 0) / 1000) }
  async previewStep(index: number) { await this.replayToStep(index) }
  async playFrom(index: number) { await this.replayToStep(index); await this.play() }
  dispose() { this.stopClock(); this.listeners.clear() }
}
