import type { EntityFeature } from '../types/geo'
import { DEFAULT_CAMERA_DURATION_MS } from './storyTimeline'
import type { StoryStep } from './storyTypes'

export const featureStoryStep=(feature:EntityFeature,action:'show'|'activate'|'hide'):StoryStep=>action==='activate'?{action,id:feature.properties.id,cameraDuration:DEFAULT_CAMERA_DURATION_MS/1000}:{action,id:feature.properties.id}
