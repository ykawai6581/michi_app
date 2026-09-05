import { expect,it } from 'vitest'
import { serializeStory } from './storySerialization'
it('serializes only authored story data in action order',()=>{const text=serializeStory({id:'demo',project:'shinjuku',steps:[{action:'show',id:'stable:id'},{action:'setView',center:[139.7,35.6],zoom:15,bearing:0,pitch:0}]});const value=JSON.parse(text);expect(value.steps.map((step:{action:string})=>step.action)).toEqual(['show','setView']);expect(value.steps[0].id).toBe('stable:id');expect(text.endsWith('\n')).toBe(true);expect(text).not.toContain('selectedKey')})
