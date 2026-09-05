/// <reference types="vite/client" />

import type { StoryPlayerState } from './story/storyPlayer'
declare global { interface Window { __michiStory?: { play(): Promise<void>; pause(): void; restart(): Promise<void>; next(): Promise<void>; previous(): Promise<void>; seek(seconds:number):Promise<void>; getDuration():number; getTime():number; waitForRender():Promise<void>; getState(): StoryPlayerState } } }
