import type { Story } from './storyTypes'
import { validateStory } from './storyValidation'

export const serializeStory = (story: Story) => `${JSON.stringify(validateStory(story), null, 2)}\n`

export function downloadStory(story: Story) {
  const url = URL.createObjectURL(new Blob([serializeStory(story)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${story.id}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export async function saveStoryToSource(story: Story): Promise<{ id: string; path: string }> {
  const validated = validateStory(story)
  const response = await fetch(`/__michi/story/${encodeURIComponent(validated.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: serializeStory(validated),
  })
  let payload: { story?: { id?: string; path?: string }; error?: { message?: string } } = {}
  try { payload = await response.json() as typeof payload } catch { /* non-JSON dev-server error */ }
  if (!response.ok) throw new Error(payload.error?.message ?? `Story save failed (${response.status})`)
  return { id: payload.story?.id ?? validated.id, path: payload.story?.path ?? `stories/${validated.id}.json` }
}
