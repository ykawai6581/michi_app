import { describe, expect, it } from 'vitest'
import { validateStory } from './storyValidation'

const story = (step: Record<string, unknown>) => ({ id: 'demo', project: 'shinjuku', steps: [step] })
describe('story validation', () => {
  it('accepts all supported presentation actions', () => expect(validateStory({ id:'demo', project:'shinjuku', steps:[{action:'show',id:'a'},{action:'hide',id:'a'},{action:'activate',id:'a',cameraDuration:0},{action:'setView',center:[139.7,35.6],zoom:15,bearing:0,pitch:0,duration:1.2},{action:'deactivate'},{action:'wait',duration:0},{action:'setBasemap',value:'rekichizu'},{action:'setOverlay',layer:'stations',visible:true},{action:'setDarkMode',value:'auto'},{action:'setDarkBasemap',value:true},{action:'selectJurisdiction',id:'ward:1'},{action:'clearJurisdiction'}] }).steps).toHaveLength(12))
  it('preserves exact jurisdiction snapshot metadata',()=>{const step={action:'activateJurisdiction',name:'東京市',level:'parent',provider:'geoshape',prefecture:'13',snapshotDate:'1932-12-31',resolution:'high',cameraDuration:1.5};expect(validateStory(story(step)).steps[0]).toEqual(step)})
  it.each([
    [{action:'foo'}, 'Unsupported story action: foo'],
    [{action:'show',id:''}, 'non-empty feature ID'],
    [{action:'wait',duration:-1}, 'at least 0'],
    [{action:'activate',id:'a',cameraDuration:-1}, 'cameraDuration'],
    [{action:'setBasemap',value:'moon'}, 'Invalid basemap'],
    [{action:'setOverlay',layer:'everything',visible:true}, 'Invalid overlay'],
    [{action:'setDarkMode',value:'sometimes'}, 'Invalid dark mode'],
    [{action:'selectJurisdiction',id:''}, 'non-empty jurisdiction ID'],
    [{action:'showJurisdiction',name:'東京市',level:'parent',provider:'geoshape',prefecture:'13',snapshotDate:'1932',resolution:'high'}, 'snapshotDate'],
    [{action:'setView',center:[1],zoom:1}, 'exactly two finite'],
    [{action:'setView',center:[181,0],zoom:1}, 'longitude'],
    [{action:'setView',center:[0,-91],zoom:1}, 'latitude'],
    [{action:'setView',center:[0,0],zoom:Infinity}, 'zoom'],
    [{action:'setView',center:[0,0],zoom:1,pitch:90}, 'pitch'],
    [{action:'setView',center:[0,0],zoom:1,duration:-1}, 'duration'],
  ])('rejects invalid step %#', (step, message) => expect(() => validateStory(story(step))).toThrow(message))
})
