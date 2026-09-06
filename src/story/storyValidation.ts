import { BASEMAP_MODES, DARK_MODE_BEHAVIORS, OVERLAY_KEYS, type Story, type StoryStep } from './storyTypes'

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const numberAtLeastZero = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

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
    case 'setView': {
      if (!Array.isArray(step.center) || step.center.length !== 2 || !step.center.every(finite)) throw new Error('Story setView center must contain exactly two finite numbers')
      const [longitude, latitude] = step.center
      if (longitude < -180 || longitude > 180) throw new Error('Story setView longitude must be between -180 and 180')
      if (latitude < -90 || latitude > 90) throw new Error('Story setView latitude must be between -90 and 90')
      if (!finite(step.zoom) || step.zoom < 0 || step.zoom > 24) throw new Error('Story setView zoom must be finite and between 0 and 24')
      if (step.bearing !== undefined && !finite(step.bearing)) throw new Error('Story setView bearing must be finite')
      if (step.pitch !== undefined && (!finite(step.pitch) || step.pitch < 0 || step.pitch > 85)) throw new Error('Story setView pitch must be finite and between 0 and 85')
      if (step.duration !== undefined && !numberAtLeastZero(step.duration)) throw new Error('Story setView duration must be at least 0')
      break
    }
    case 'setBasemap': if (!BASEMAP_MODES.includes(step.value as never)) throw new Error(`Invalid basemap in story: ${String(step.value)}`); break
    case 'setOverlay':
      if (!OVERLAY_KEYS.includes(step.layer as never)) throw new Error(`Invalid overlay in story: ${String(step.layer)}`)
      if (typeof step.visible !== 'boolean') throw new Error('Story overlay visibility must be boolean')
      break
    case 'setDarkMode': if (!DARK_MODE_BEHAVIORS.includes(step.value as never)) throw new Error(`Invalid dark mode in story: ${String(step.value)}`); break
    case 'setDarkBasemap': if (typeof step.value !== 'boolean') throw new Error('Story dark basemap value must be boolean'); break
    case 'selectJurisdiction': if (!text(step.id)) throw new Error('Story selectJurisdiction requires a non-empty jurisdiction ID'); break
    case 'showJurisdiction': case 'hideJurisdiction': case 'activateJurisdiction':
      if (!text(step.name)) throw new Error(`Story ${step.action} requires a jurisdiction name`)
      if (step.level !== 'municipality' && step.level !== 'parent') throw new Error(`Invalid jurisdiction level: ${String(step.level)}`)
      if (!text(step.provider) || !text(step.prefecture)) throw new Error(`Story ${step.action} requires provider and prefecture`)
      if (!text(step.snapshotDate) || !/^\d{4}-\d{2}-\d{2}$/.test(step.snapshotDate)) throw new Error(`Invalid jurisdiction snapshotDate: ${String(step.snapshotDate)}`)
      if (step.resolution !== 'low' && step.resolution !== 'high') throw new Error(`Invalid jurisdiction resolution: ${String(step.resolution)}`)
      if (step.action === 'activateJurisdiction' && step.cameraDuration !== undefined && !numberAtLeastZero(step.cameraDuration)) throw new Error('Invalid cameraDuration in story')
      break
    case 'deactivate': case 'clearJurisdiction': break
    default: throw new Error(`Unsupported story action: ${step.action}`)
  }
  if (step.label !== undefined && !text(step.label)) throw new Error(`Invalid story label at index ${index}`)
}
