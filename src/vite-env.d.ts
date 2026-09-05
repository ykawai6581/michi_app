/// <reference types="vite/client" />

import type { StoryPlayerState } from './story/storyPlayer'
declare global { interface Window { __michiStory?: { play(): Promise<void>; pause(): void; restart(): Promise<void>; next(): Promise<void>; previous(): Promise<void>; getState(): StoryPlayerState } } }
