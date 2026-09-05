import { describe, expect, it } from 'vitest'
import { parseStoryQuery, resolveStoryProject } from './storyLoader'
const story={id:'demo',project:'shinjuku',steps:[]}
describe('story URL options',()=>{
  it('parses story mode without changing defaults',()=>expect(parseStoryQuery('?story=demo')).toEqual({storyId:'demo',projectId:undefined,capture:false,autoplay:false}))
  it('makes capture clean mode imply autoplay',()=>expect(parseStoryQuery('?project=shinjuku&story=demo&capture=1')).toMatchObject({capture:true,autoplay:true}))
  it('allows capture callers to disable autoplay and request an initial time',()=>expect(parseStoryQuery('?story=demo&capture=1&autoplay=0&t=12.4')).toMatchObject({capture:true,autoplay:false,time:12.4}))
  it('supports explicit autoplay',()=>expect(parseStoryQuery('?story=demo&autoplay=1').autoplay).toBe(true))
  it('uses the story project and rejects disagreement',()=>{expect(resolveStoryProject(parseStoryQuery('?story=demo'),story)).toBe('shinjuku');expect(()=>resolveStoryProject(parseStoryQuery('?project=other&story=demo'),story)).toThrow('Story project mismatch')})
})
