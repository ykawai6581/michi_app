import { PROJECT_ID_PATTERN } from '../data/project'
import { validateStory } from './storyValidation'
import type { Story } from './storyTypes'

const authoredStories = import.meta.glob('../../stories/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
export interface StoryQuery { projectId?: string; storyId?: string; capture: boolean; autoplay: boolean; time?: number }

export function parseStoryQuery(search: string): StoryQuery {
  const params = new URLSearchParams(search); const storyId = params.get('story')?.trim() || undefined; const projectId = params.get('project')?.trim() || undefined
  const capture = params.get('capture') === '1'
  const explicitAutoplay = params.get('autoplay')
  const time = params.has('t') && Number.isFinite(Number(params.get('t'))) ? Math.max(0, Number(params.get('t'))) : undefined
  return { storyId, projectId, capture, autoplay: explicitAutoplay === null ? capture : explicitAutoplay === '1', ...(time === undefined ? {} : { time }) }
}
export async function loadStory(id: string): Promise<Story> {
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error(`Unsafe story ID: ${id}`)
  const path = Object.keys(authoredStories).find((candidate) => candidate.endsWith(`/${id}.json`))
  if (!path) throw new Error(`Story not found: ${id}`)
  const story = validateStory(JSON.parse(authoredStories[path]))
  if (story.id !== id) throw new Error(`Story ID mismatch: requested ${id}, found ${story.id}`)
  return story
}
export function resolveStoryProject(query: StoryQuery, story: Story): string {
  if (query.projectId && query.projectId !== story.project) throw new Error(`Story project mismatch: URL uses ${query.projectId}, story uses ${story.project}`)
  return query.projectId ?? story.project
}
