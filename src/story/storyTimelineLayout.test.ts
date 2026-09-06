import { describe, expect, it } from 'vitest'
import { layoutTimeline, timeToX } from './storyTimelineLayout'
describe('timeline layout',()=>{
 it('uses one time transform and stacks simultaneous zero-duration events in order',()=>{expect(timeToX(1500,100)).toBe(150);const events=[{stepIndex:0,startMs:0,endMs:0},{stepIndex:1,startMs:0,endMs:0},{stepIndex:2,startMs:0,endMs:800},{stepIndex:3,startMs:800,endMs:800}];expect(layoutTimeline({events} as never)).toEqual([{stepIndex:0,startMs:0,durationMs:0,stack:0},{stepIndex:1,startMs:0,durationMs:0,stack:1},{stepIndex:2,startMs:0,durationMs:800,stack:0},{stepIndex:3,startMs:800,durationMs:0,stack:0}])})
})
