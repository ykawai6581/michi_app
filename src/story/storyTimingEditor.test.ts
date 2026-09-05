import { describe, expect, it, vi } from 'vitest'
import { authoredStepDuration, seekStoryPreview } from './storyTimingEditor'

describe('Story timing editor helpers',()=>{
  it('shows authored timing and the legacy fallback only for timed rows',()=>{
    expect(authoredStepDuration({action:'activate',id:'a',cameraDuration:.8})).toBe(.8)
    expect(authoredStepDuration({action:'activate',id:'a'})).toBe(1.2)
    expect(authoredStepDuration({action:'wait',duration:1.5})).toBe(1.5)
    expect(authoredStepDuration({action:'show',id:'a'})).toBeNull()
  })
  it('pauses and delegates scrubber movement to deterministic seek',async()=>{
    const player={pause:vi.fn(),seek:vi.fn(async()=>{})}
    await seekStoryPreview(player,7.26)
    expect(player.pause).toHaveBeenCalledOnce()
    expect(player.seek).toHaveBeenCalledWith(7.26)
  })
})
