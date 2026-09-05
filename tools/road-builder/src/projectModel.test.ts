import{describe,expect,it}from'vitest'
import{emptyProject,initialProjectVisibility,projectSavePlan,selectHistoricalRoute,serializeProject,toggleProjectLayer}from'./projectModel'
describe('project authoring model',()=>{
 it('uses authoring defaults',()=>expect(emptyProject()).toEqual({id:'',displayName:'',bounds:{mode:'auto',from:'modernRoads',paddingKm:3},layers:{modernRoads:[],locations:[],historicalRoads:[],historicalPosts:[]}}))
 it('selects independent locations',()=>expect(toggleProjectLayer(emptyProject(),'locations','shinjuku-oiwake').layers.locations).toEqual(['shinjuku-oiwake']))
 it('selects multiple modern roads',()=>{let p=toggleProjectLayer(emptyProject(),'modernRoads','one');p=toggleProjectLayer(p,'modernRoads','two');expect(p.layers.modernRoads).toEqual(['one','two'])})
 it('toggles rail and stations independently',()=>{let p=toggleProjectLayer(emptyProject(),'railways');p=toggleProjectLayer(p,'stations');expect(p.layers).toMatchObject({railways:{mode:'near-modern-roads',distanceKm:3},stations:{mode:'bbox'}});expect(toggleProjectLayer(p,'railways').layers.railways).toBeUndefined()})
 it('defaults posts on with a route but keeps them independently toggleable',()=>{const selected=selectHistoricalRoute(emptyProject(),'R003');expect(selected.layers.historicalRoads).toEqual(['R003']);expect(selected.layers.historicalPosts).toEqual(['R003']);expect(toggleProjectLayer(selected,'historicalPosts','R003').layers.historicalPosts).toEqual([])})
 it('keeps branch CODH route IDs exact',()=>expect(selectHistoricalRoute(emptyProject(),'R400-1').layers.historicalRoads).toEqual(['R400-1']))
 it('supports explicit bounds and stable serialization',()=>{const p={...emptyProject(),bounds:[139,35,140,36]as[number,number,number,number]};expect(serializeProject(p).bounds).toEqual([139,35,140,36])})
 it('models all project layers as independently visible',()=>expect(initialProjectVisibility()).toEqual({modernRoads:true,railways:true,stations:true,historicalRoads:true,historicalPosts:true,locations:true}))
 it('plans create and update HTTP semantics from the exact current project ID',()=>{
  expect(projectSavePlan('koshu-video',['shinjuku'])).toEqual({existing:false,method:'POST',path:'/api/projects',saveLabel:'Save Project',buildLabel:'Save & Build'})
  expect(projectSavePlan('shinjuku',['shinjuku'])).toEqual({existing:true,method:'PUT',path:'/api/projects/shinjuku',saveLabel:'Update Project',buildLabel:'Update & Build'})
 })
})
