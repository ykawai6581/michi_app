import { describe,expect,it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { featureStoryStep } from '../story/storySearchActions'

const feature={type:'Feature',properties:{id:'historical-road:R003:0',name:'甲州道中',type:'historical-road'},geometry:{type:'LineString',coordinates:[]}} as EntityFeature
describe('Story search action composition',()=>{
  it('builds exact show, activate, and hide actions',()=>{
    expect(featureStoryStep(feature,'show')).toEqual({action:'show',id:'historical-road:R003:0'})
    expect(featureStoryStep(feature,'activate')).toEqual({action:'activate',id:'historical-road:R003:0',cameraDuration:1.2})
    expect(featureStoryStep(feature,'hide')).toEqual({action:'hide',id:'historical-road:R003:0'})
  })
})
