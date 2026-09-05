import type { Story } from './storyTypes'
import { validateStory } from './storyValidation'
export const serializeStory = (story: Story) => `${JSON.stringify(validateStory(story), null, 2)}\n`
export function downloadStory(story: Story) { const url = URL.createObjectURL(new Blob([serializeStory(story)], { type: 'application/json;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${story.id}.json`; link.click(); URL.revokeObjectURL(url) }
