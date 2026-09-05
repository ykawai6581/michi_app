import { describe, expect, it } from 'vitest'
import type { EntityFeature } from '../types/geo'
import { partialFeature } from './highlight'

const line: EntityFeature = { type:'Feature', properties:{id:'road',name:'Road',type:'road'}, geometry:{type:'LineString',coordinates:[[0,0],[100,0]]} }
describe('explicit feature reveal geometry',()=>{
  it.each([[0,0],[.25,25],[.5,50],[1,100]])('renders %s progress without consulting a clock',(progress,end)=>{
    const result=partialFeature(line,progress)
    expect(result.geometry.type).toBe('LineString')
    if(result.geometry.type==='LineString')expect(result.geometry.coordinates.at(-1)?.[0]).toBe(end)
  })
})
