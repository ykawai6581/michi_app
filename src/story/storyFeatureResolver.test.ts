import { describe, expect, it } from 'vitest'
import type { ProjectData } from '../data/project'
import type { EntityFeature } from '../types/geo'
import { findProjectFeatureById } from './storyFeatureResolver'
const feature = (id:string,type:EntityFeature['properties']['type']):EntityFeature => ({type:'Feature',properties:{id,name:id,type},geometry:{type:'Point',coordinates:[0,0]}})
describe('story feature resolution',()=>{
  const searchable=[feature('road','road'),feature('history','historical-road'),feature('station','station'),feature('post','historical-place'),feature('location','place'),feature('rail','railway')]
  const project={searchable} as ProjectData
  it.each(searchable.map((item)=>item.properties.id))('finds canonical feature %s',(id)=>expect(findProjectFeatureById(project,id).properties.id).toBe(id))
  it('fails explicitly for an unknown ID',()=>expect(()=>findProjectFeatureById(project,'missing')).toThrow('Story feature not found: missing'))
})
