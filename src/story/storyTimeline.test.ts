import { describe, expect, it } from 'vitest'
import type { ProjectData } from '../data/project'
import type { EntityFeature } from '../types/geo'
import type { Story, StoryAppSnapshot } from './storyTypes'
import { compileStoryTimeline, evaluateTimeline, FEATURE_REVEAL_DURATION_MS, interpolateCamera } from './storyTimeline'

const point = (id:string, coordinates:[number,number]=[10,20]):EntityFeature => ({type:'Feature',properties:{id,name:id,type:'place'},geometry:{type:'Point',coordinates}})
const line:EntityFeature = {type:'Feature',properties:{id:'road',name:'road',type:'road'},geometry:{type:'LineString',coordinates:[[0,0],[10,0]]}}
const project={searchable:[point('place'),line]} as ProjectData
const baseline:StoryAppSnapshot={selected:[],activeFeature:null,basemap:'presentation',layers:{basemap:'presentation',darkBasemap:false,modernRoads:true,railways:true,stations:true,historicalRoads:true,historicalPosts:true,jurisdictions:false},darkMode:'auto',jurisdiction:null,camera:{center:[0,0],zoom:10,bearing:179,pitch:0}}
const compile=(steps:Story['steps'])=>compileStoryTimeline({id:'x',project:'x',steps},project,baseline,(feature,_visible,from)=>feature.geometry.type==='Point'?{...from,center:feature.geometry.coordinates as [number,number],zoom:15}:{center:[20,10],zoom:14,bearing:-179,pitch:40})

describe('Story timeline compilation',()=>{
  it('keeps instant actions at one cursor and includes all timed actions in duration',()=>{const timeline=compile([{action:'show',id:'road'},{action:'activate',id:'road',cameraDuration:1.2},{action:'wait',duration:2},{action:'setView',center:[30,20],zoom:12,bearing:0,pitch:0,duration:1}]);expect(timeline.stepBoundariesMs).toEqual([0,0,1200,3200]);expect(timeline.durationMs).toBe(4200)})
  it('uses the default camera duration and supports zero-duration jumps',()=>{expect(compile([{action:'setView',center:[1,2],zoom:3,bearing:4,pitch:5}]).durationMs).toBe(1200);const timeline=compile([{action:'setView',center:[1,2],zoom:3,bearing:4,pitch:5,duration:0}]);expect(timeline.durationMs).toBe(0);expect(evaluateTimeline(timeline,0).camera.center).toEqual([1,2])})
})

describe('Story timeline evaluation',()=>{
  const timeline=compile([{action:'show',id:'road'},{action:'activate',id:'road',cameraDuration:1.5},{action:'wait',duration:1},{action:'setView',center:[30,20],zoom:12,bearing:20,pitch:10,duration:1}])
  it('evaluates baseline, activation, waits, authored camera motion, and final frame',()=>{const start=evaluateTimeline(timeline,0);expect(start.visibleIds).toEqual(['road']);expect(start.activeFeatureId).toBe('road');expect(start.lineReveal?.progress).toBe(0);expect(evaluateTimeline(timeline,625).lineReveal?.progress).toBeCloseTo(0.875);expect(evaluateTimeline(timeline,1500).camera.center).toEqual([20,10]);expect(evaluateTimeline(timeline,2000).camera.center).toEqual([20,10]);expect(evaluateTimeline(timeline,3000).camera.center[0]).toBeGreaterThan(20);expect(evaluateTimeline(timeline,99999).camera.center).toEqual([30,20])})
  it('clamps negative, excessive, and NaN evaluation times',()=>{expect(evaluateTimeline(timeline,-10).timeMs).toBe(0);expect(evaluateTimeline(timeline,Infinity).timeMs).toBe(0);expect(evaluateTimeline(timeline,99999).timeMs).toBe(timeline.durationMs)})
  it('is independent of evaluation order',()=>{const a=evaluateTimeline(timeline,1240);evaluateTimeline(timeline,20);expect(evaluateTimeline(timeline,1240)).toEqual(a)})
  it('uses the fixed reveal duration',()=>expect(FEATURE_REVEAL_DURATION_MS).toBe(1250))
})

describe('camera interpolation',()=>{
  it('interpolates all camera fields with shortest-path bearing',()=>{const result=interpolateCamera(baseline.camera,{center:[10,20],zoom:20,bearing:-179,pitch:40},0.5);expect(result.center).toEqual([8.75,17.5]);expect(result.zoom).toBe(18.75);expect(result.pitch).toBe(35);expect(result.bearing).toBeCloseTo(180.75)})
})
