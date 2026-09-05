import { describe, expect, it } from 'vitest'
import { validateStory } from './storyValidation'

const story = (step: Record<string, unknown>) => ({ id: 'demo', project: 'shinjuku', steps: [step] })
describe('story validation', () => {
  it('accepts all supported presentation actions', () => expect(validateStory({ id:'demo', project:'shinjuku', steps:[{action:'show',id:'a'},{action:'hide',id:'a'},{action:'activate',id:'a',cameraDuration:0},{action:'deactivate'},{action:'wait',duration:0},{action:'setBasemap',value:'rekichizu'},{action:'setOverlay',layer:'stations',visible:true},{action:'setDarkMode',value:'auto'},{action:'setDarkBasemap',value:true},{action:'selectJurisdiction',id:'ward:1'},{action:'clearJurisdiction'}] }).steps).toHaveLength(11))
  it.each([
    [{action:'foo'}, 'Unsupported story action: foo'],
    [{action:'show',id:''}, 'non-empty feature ID'],
    [{action:'wait',duration:-1}, 'at least 0'],
    [{action:'activate',id:'a',cameraDuration:-1}, 'cameraDuration'],
    [{action:'setBasemap',value:'moon'}, 'Invalid basemap'],
    [{action:'setOverlay',layer:'everything',visible:true}, 'Invalid overlay'],
    [{action:'setDarkMode',value:'sometimes'}, 'Invalid dark mode'],
    [{action:'selectJurisdiction',id:''}, 'non-empty jurisdiction ID'],
  ])('rejects invalid step %#', (step, message) => expect(() => validateStory(story(step))).toThrow(message))
})
