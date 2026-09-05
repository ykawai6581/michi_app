import { BASEMAP_MODES, DARK_MODE_BEHAVIORS, OVERLAY_KEYS, type Story, type StoryStep } from './storyTypes'

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const numberAtLeastZero = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function validateStory(input: unknown): Story {
  if (!input || typeof input !== 'object') throw new Error('Story must be an object')
  const value = input as Record<string, unknown>
  if (!text(value.id)) throw new Error('Story ID must be non-empty')
  if (!text(value.project)) throw new Error('Story project must be non-empty')
  if (!Array.isArray(value.steps)) throw new Error('Story steps must be an array')
  value.steps.forEach((raw, index) => validateStep(raw, index))
  return value as unknown as Story
}

function validateStep(raw: unknown, index: number): asserts raw is StoryStep {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid story step at index ${index}`)
  const step = raw as Record<string, unknown>
  if (!text(step.action)) throw new Error(`Unsupported story action: ${String(step.action)}`)
  switch (step.action) {
    case 'show': case 'hide': case 'activate':
      if (!text(step.id)) throw new Error(`Story ${step.action} requires a non-empty feature ID`)
      if (step.action === 'activate' && step.cameraDuration !== undefined && !numberAtLeastZero(step.cameraDuration)) throw new Error('Invalid cameraDuration in story')
      break
    case 'wait': if (!numberAtLeastZero(step.duration)) throw new Error('Story wait duration must be at least 0'); break
    case 'setBasemap': if (!BASEMAP_MODES.includes(step.value as never)) throw new Error(`Invalid basemap in story: ${String(step.value)}`); break
    case 'setOverlay':
      if (!OVERLAY_KEYS.includes(step.layer as never)) throw new Error(`Invalid overlay in story: ${String(step.layer)}`)
      if (typeof step.visible !== 'boolean') throw new Error('Story overlay visibility must be boolean')
      break
    case 'setDarkMode': if (!DARK_MODE_BEHAVIORS.includes(step.value as never)) throw new Error(`Invalid dark mode in story: ${String(step.value)}`); break
    case 'setDarkBasemap': if (typeof step.value !== 'boolean') throw new Error('Story dark basemap value must be boolean'); break
    case 'selectJurisdiction': if (!text(step.id)) throw new Error('Story selectJurisdiction requires a non-empty jurisdiction ID'); break
    case 'deactivate': case 'clearJurisdiction': break
    default: throw new Error(`Unsupported story action: ${step.action}`)
  }
  if (step.label !== undefined && !text(step.label)) throw new Error(`Invalid story label at index ${index}`)
}
