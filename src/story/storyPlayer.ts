import type { ProjectData } from '../data/project'
import { findProjectFeatureById } from './storyFeatureResolver'
import type { Story, StoryAppOperations, StoryStep } from './storyTypes'

export type StoryPlayerStatus = 'idle' | 'playing' | 'paused' | 'complete' | 'error'
export interface StoryPlayerState { status: StoryPlayerStatus; currentStepIndex: number; currentStep: StoryStep | null; elapsedSeconds: number; totalWaitDuration: number; error: string | null }
export interface StoryClock { now(): number; schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void }
const systemClock: StoryClock = { now: () => performance.now(), schedule: (callback, delay) => setTimeout(callback, delay), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }

export class StoryPlayer {
  private readonly baseline; private listeners = new Set<() => void>(); private timer: unknown; private waitStarted = 0; private waitRemainingMs: number | null = null; private generation = 0; private cameraAbort?: AbortController
  private state: StoryPlayerState
  private snapshot: StoryPlayerState
  constructor(private story: Story, private project: ProjectData, private operations: StoryAppOperations, private clock: StoryClock = systemClock) {
    this.baseline = operations.snapshot()
    this.state = { status: 'paused', currentStepIndex: 0, currentStep: story.steps[0] ?? null, elapsedSeconds: 0, totalWaitDuration: story.steps.reduce((sum, step) => sum + (step.action === 'wait' ? step.duration : 0), 0), error: null }
    this.snapshot = { ...this.state }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getState = () => this.snapshot
  private emit() { this.state.currentStep = this.story.steps[this.state.currentStepIndex] ?? null; this.snapshot = { ...this.state }; this.listeners.forEach((listener) => listener()) }
  private setError(error: unknown) { this.cancelWait(); this.state.status = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.emit(); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('michi:story-error', { detail: this.state.error })) }
  private cancelWait() { if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined; this.cameraAbort?.abort(); this.cameraAbort = undefined; this.generation++ }
  private completedWaitSeconds(index = this.state.currentStepIndex) { return this.story.steps.slice(0, index).reduce((sum, step) => sum + (step.action === 'wait' ? step.duration : 0), 0) }
  private async apply(step: StoryStep, options: { reconstruct?: boolean } = {}) {
    const quiet = options.reconstruct ? { animateCamera: false } : undefined
    switch (step.action) {
      case 'show': return this.operations.showFeature(findProjectFeatureById(this.project, step.id))
      case 'hide': return this.operations.hideFeature(findProjectFeatureById(this.project, step.id))
      case 'activate': return this.operations.activateFeature(findProjectFeatureById(this.project, step.id), { ...quiet, durationMs: step.cameraDuration === undefined ? undefined : step.cameraDuration * 1000 })
      case 'setView': {
        const controller = new AbortController(); this.cameraAbort?.abort(); this.cameraAbort = controller
        try { return await this.operations.setView({ center: step.center, zoom: step.zoom, bearing: step.bearing ?? 0, pitch: step.pitch ?? 0 }, { animateCamera: !options.reconstruct, durationMs: (step.duration ?? 1.2) * 1000, signal: controller.signal }) }
        finally { if (this.cameraAbort === controller) this.cameraAbort = undefined }
      }
      case 'deactivate': return this.operations.deactivateFeature()
      case 'setBasemap': return this.operations.setBasemap(step.value)
      case 'setOverlay': return this.operations.setOverlayVisibility(step.layer, step.visible)
      case 'setDarkMode': return this.operations.setDarkMode(step.value)
      case 'setDarkBasemap': return this.operations.setManualDarkBasemap(step.value)
      case 'selectJurisdiction': return this.operations.selectJurisdiction(step.id, quiet)
      case 'clearJurisdiction': return this.operations.clearJurisdiction()
      case 'wait': return
    }
  }
  async play() {
    if (this.state.status === 'complete' || this.state.status === 'error' || this.state.status === 'playing') return
    this.state.status = 'playing'; this.emit()
    try {
      while (this.state.status === 'playing' && this.state.currentStepIndex < this.story.steps.length) {
        const step = this.story.steps[this.state.currentStepIndex]
        if (step.action === 'wait') { await this.runWait(step.duration * 1000); if (this.state.status !== 'playing') return }
        else { await this.apply(step); if (this.state.status !== 'playing') return }
        this.state.currentStepIndex++; this.waitRemainingMs = null; this.state.elapsedSeconds = this.completedWaitSeconds(); this.emit()
      }
      if (this.state.status === 'playing') { this.state.status = 'complete'; this.emit(); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('michi:story-complete')) }
    } catch (error) { this.setError(error) }
  }
  private runWait(fullMs: number) {
    const duration = this.waitRemainingMs ?? fullMs; const generation = ++this.generation; this.waitStarted = this.clock.now(); this.waitRemainingMs = duration
    return new Promise<void>((resolve) => { this.timer = this.clock.schedule(() => { if (generation === this.generation) { this.timer = undefined; this.waitRemainingMs = 0; resolve() } }, duration) })
  }
  pause() {
    if (this.state.status !== 'playing') return
    if (this.timer !== undefined && this.waitRemainingMs !== null) { const spent = Math.max(0, this.clock.now() - this.waitStarted); this.waitRemainingMs = Math.max(0, this.waitRemainingMs - spent); this.state.elapsedSeconds = this.completedWaitSeconds() + (this.story.steps[this.state.currentStepIndex]?.action === 'wait' ? (this.story.steps[this.state.currentStepIndex] as {duration:number}).duration - this.waitRemainingMs / 1000 : 0) }
    this.cancelWait(); this.state.status = 'paused'; this.emit()
  }
  async restart() { this.cancelWait(); await this.operations.restore(this.baseline, { animateCamera: false }); this.waitRemainingMs = null; this.state = { ...this.state, status: 'paused', currentStepIndex: 0, elapsedSeconds: 0, error: null }; this.emit() }
  async next() {
    this.pause(); if (this.state.status === 'error' || this.state.currentStepIndex >= this.story.steps.length) return
    try { const step = this.story.steps[this.state.currentStepIndex]; if (step.action !== 'wait') await this.apply(step); this.state.currentStepIndex++; this.waitRemainingMs = null; this.state.elapsedSeconds = this.completedWaitSeconds(); this.state.status = this.state.currentStepIndex >= this.story.steps.length ? 'complete' : 'paused'; this.emit() } catch (error) { this.setError(error) }
  }
  async previous() { this.pause(); const target = Math.max(0, this.state.currentStepIndex - 1); await this.replayToStep(target) }
  async replayToStep(target: number) {
    this.cancelWait()
    try { await this.operations.restore(this.baseline, { animateCamera: false }); for (const step of this.story.steps.slice(0, target)) if (step.action !== 'wait') await this.apply(step, { reconstruct: true }); this.state.currentStepIndex = target; this.waitRemainingMs = null; this.state.elapsedSeconds = this.completedWaitSeconds(target); this.state.status = 'paused'; this.state.error = null; this.emit() } catch (error) { this.setError(error) }
  }
  async previewStep(index: number) { this.pause(); const step = this.story.steps[index]; if (!step || step.action === 'wait') return; try { await this.apply(step) } catch (error) { this.setError(error) } }
  async playFrom(index: number) { await this.replayToStep(index); await this.play() }
  dispose() { this.cancelWait(); this.listeners.clear() }
}
