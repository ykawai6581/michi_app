import type { CameraView, Story, StoryStep } from './storyTypes'

export interface EditorStep { key: string; step: StoryStep }
export interface StoryEditorModel { story: Omit<Story, 'steps'>; steps: EditorStep[]; selectedKey: string | null }
let nextKey = 0
const key = () => `story-step-${++nextKey}`
export const createEditorModel = (story: Story): StoryEditorModel => ({ story: { id: story.id, displayName: story.displayName, project: story.project }, steps: structuredClone(story.steps).map((step) => ({ key: key(), step })), selectedKey: null })
export const toStory = (model: StoryEditorModel): Story => ({ ...model.story, steps: model.steps.map(({ step }) => structuredClone(step)) })
export function insertStep(model: StoryEditorModel, step: StoryStep): StoryEditorModel { const at = model.selectedKey ? model.steps.findIndex(({ key }) => key === model.selectedKey) + 1 : model.steps.length; const entry = { key: key(), step: structuredClone(step) }; const steps = [...model.steps]; steps.splice(at, 0, entry); return { ...model, steps, selectedKey: entry.key } }
export function reorderStep(model: StoryEditorModel, from: number, to: number): StoryEditorModel { if (from === to || from < 0 || to < 0 || from >= model.steps.length || to >= model.steps.length) return model; const steps = [...model.steps]; const [entry] = steps.splice(from, 1); steps.splice(to, 0, entry); return { ...model, steps } }
export function duplicateStep(model: StoryEditorModel, entryKey: string): StoryEditorModel { const index = model.steps.findIndex(({ key }) => key === entryKey); if (index < 0) return model; const entry = { key: key(), step: structuredClone(model.steps[index].step) }; const steps = [...model.steps]; steps.splice(index + 1, 0, entry); return { ...model, steps, selectedKey: entry.key } }
export function deleteStep(model: StoryEditorModel, entryKey: string): StoryEditorModel { const index = model.steps.findIndex(({ key }) => key === entryKey); if (index < 0) return model; const steps = model.steps.filter(({ key }) => key !== entryKey); return { ...model, steps, selectedKey: model.selectedKey === entryKey ? (steps[Math.min(index, steps.length - 1)]?.key ?? null) : model.selectedKey } }
export function updateStep(model: StoryEditorModel, entryKey: string, step: StoryStep): StoryEditorModel { return { ...model, steps: model.steps.map((entry) => entry.key === entryKey ? { ...entry, step } : entry) } }
export const currentViewStep = (view: CameraView): StoryStep => ({ action: 'setView', ...structuredClone(view), duration: 0.8, label: 'Saved view' })
