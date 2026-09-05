import{describe,expect,it}from'vitest'
import{renderToStaticMarkup}from'react-dom/server'
import LocationEditor from'./LocationEditor'
import{emptyLocation}from'./model'
describe('independent location editor',()=>{it('uses reveal-area defaults',()=>expect(emptyLocation()).toMatchObject({presentationType:'reveal-area',revealRadiusPx:120}));it('exposes independent location authoring controls',()=>{const html=renderToStaticMarkup(<LocationEditor/>);expect(html).toContain('New location');expect(html).toContain('Load existing location');expect(html).toContain('Pick on map');expect(html).toContain('Reveal area')})})
