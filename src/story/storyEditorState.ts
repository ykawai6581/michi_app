import type { CameraView, Story, StoryStep } from './storyTypes'

export interface EditorStep { key: string; step: StoryStep }
export interface StoryEditorModel {
  story: Omit<Story, 'steps'>
  steps: EditorStep[]
  selectedKeys: string[]
  selectionAnchorKey: string | null
}

let nextKey = 0
const key = () => `story-step-${++nextKey}`
const selectedSet = (model: StoryEditorModel) => new Set(model.selectedKeys)
const lastSelectedIndex = (model: StoryEditorModel, selected: Set<string>) => {
  for (let index = model.steps.length - 1; index >= 0; index--) if (selected.has(model.steps[index].key)) return index
  return -1
}

export const createEditorModel = (story: Story): StoryEditorModel => ({
  story: { id: story.id, displayName: story.displayName, project: story.project },
  steps: structuredClone(story.steps).map((step) => ({ key: key(), step })),
  selectedKeys: [],
  selectionAnchorKey: null,
})
export const toStory = (model: StoryEditorModel): Story => ({ ...model.story, steps: model.steps.map(({ step }) => structuredClone(step)) })

export function selectOnly(model: StoryEditorModel, entryKey: string): StoryEditorModel {
  return model.steps.some(entry => entry.key === entryKey) ? { ...model, selectedKeys: [entryKey], selectionAnchorKey: entryKey } : model
}
export function toggleSelection(model: StoryEditorModel, entryKey: string): StoryEditorModel {
  if (!model.steps.some(entry => entry.key === entryKey)) return model
  const selected = selectedSet(model)
  if (selected.has(entryKey)) selected.delete(entryKey)
  else selected.add(entryKey)
  return { ...model, selectedKeys: model.steps.filter(entry => selected.has(entry.key)).map(entry => entry.key), selectionAnchorKey: entryKey }
}
export function selectRange(model: StoryEditorModel, entryKey: string): StoryEditorModel {
  const end = model.steps.findIndex(entry => entry.key === entryKey)
  const start = model.steps.findIndex(entry => entry.key === model.selectionAnchorKey)
  if (end < 0) return model
  if (start < 0) return selectOnly(model, entryKey)
  const [from, to] = start < end ? [start, end] : [end, start]
  return { ...model, selectedKeys: model.steps.slice(from, to + 1).map(entry => entry.key) }
}
export const insertionIndex = (model: StoryEditorModel) => {
  const selected = selectedSet(model)
  const latest = lastSelectedIndex(model, selected)
  return latest < 0 ? model.steps.length : latest + 1
}
export function insertStep(model: StoryEditorModel, step: StoryStep): StoryEditorModel {
  const at = insertionIndex(model)
  const entry = { key: key(), step: structuredClone(step) }
  const steps = [...model.steps]; steps.splice(at, 0, entry)
  return { ...model, steps, selectedKeys: [entry.key], selectionAnchorKey: entry.key }
}

/** Move selected entries to an insertion boundary in the original sequence. */
export function moveSelectedTo(model: StoryEditorModel, insertion: number): StoryEditorModel {
  const selected = selectedSet(model)
  if (!selected.size) return model
  const moving = model.steps.filter(entry => selected.has(entry.key))
  const before = model.steps.slice(0, Math.max(0, Math.min(insertion, model.steps.length))).filter(entry => !selected.has(entry.key)).length
  const remaining = model.steps.filter(entry => !selected.has(entry.key))
  const steps = [...remaining]; steps.splice(before, 0, ...moving)
  return { ...model, steps }
}
export function moveSelectedEarlier(model: StoryEditorModel): StoryEditorModel {
  const selected = selectedSet(model); const first = model.steps.findIndex(entry => selected.has(entry.key))
  if (first <= 0) return model
  return moveSelectedTo(model, first - 1)
}
export function moveSelectedLater(model: StoryEditorModel): StoryEditorModel {
  const selected = selectedSet(model); const last = lastSelectedIndex(model, selected)
  if (last < 0 || last >= model.steps.length - 1) return model
  return moveSelectedTo(model, last + 2)
}
export function duplicateStep(model: StoryEditorModel, entryKey: string): StoryEditorModel {
  const index = model.steps.findIndex(entry => entry.key === entryKey); if (index < 0) return model
  const entry = { key: key(), step: structuredClone(model.steps[index].step) }; const steps = [...model.steps]; steps.splice(index + 1, 0, entry)
  return { ...model, steps, selectedKeys: [entry.key], selectionAnchorKey: entry.key }
}
export function deleteSelected(model: StoryEditorModel): StoryEditorModel {
  const selected = selectedSet(model); if (!selected.size) return model
  return { ...model, steps: model.steps.filter(entry => !selected.has(entry.key)), selectedKeys: [], selectionAnchorKey: null }
}
export function deleteStep(model: StoryEditorModel, entryKey: string): StoryEditorModel { return deleteSelected(selectOnly(model, entryKey)) }
export function updateStep(model: StoryEditorModel, entryKey: string, step: StoryStep): StoryEditorModel { return { ...model, steps: model.steps.map(entry => entry.key === entryKey ? { ...entry, step } : entry) } }
export const currentViewStep = (view: CameraView): StoryStep => ({ action: 'setView', ...structuredClone(view), duration: 0.8, label: 'Saved view' })
