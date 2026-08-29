import {describe,expect,it} from 'vitest';import {removeAt,toggle,uniqueAdd} from './model'
describe('road form helpers',()=>{it('adds and removes exact OSM names',()=>expect(removeAt(uniqueAdd(['青梅街道'],'Ome Kaido'),0)).toEqual(['Ome Kaido']));it('toggles N13 classes without duplicates',()=>expect(toggle(toggle([], '5'),'5')).toEqual([]))})
