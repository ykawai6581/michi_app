import{describe,expect,it,vi}from'vitest'
import{applyRoadMapVisibility,removeLegacyRoadBuilderLayers,synchronizeRoadMapData}from'./roadMapLifecycle'
import{initialLayerVisibility,toggleLayerVisibility}from'./model'

const collection=(id:string)=>({type:'FeatureCollection' as const,features:[{type:'Feature' as const,properties:{n13AtomId:id},geometry:{type:'LineString' as const,coordinates:[[0,0],[1,1]]}}]})
function fakeMap(){
 const sources=new Map<string,{setData:ReturnType<typeof vi.fn>}>(),layers=new Set<string>()
 const map={getSource:vi.fn((id:string)=>sources.get(id)),addSource:vi.fn((id:string)=>sources.set(id,{setData:vi.fn()})),
  getLayer:vi.fn((id:string)=>layers.has(id)?{}:undefined),addLayer:vi.fn((layer:{id:string})=>layers.add(layer.id)),
  setLayoutProperty:vi.fn(),on:vi.fn(),removeLayer:vi.fn(),removeSource:vi.fn()}
 return{map:map as never,sources,layers}
}
describe('Road Builder MapLibre lifecycle',()=>{
 it('updates visual and hit visibility immediately without touching GeoJSON data',()=>{
  const{map,sources}=fakeMap(),visibility=initialLayerVisibility()
  synchronizeRoadMapData(map,{autoSelected:collection('A'),unselectedShortlist:collection('B')},visibility,{} as never,()=>{})
  const auto=sources.get('autoSelected')!.setData,shortlist=sources.get('unselectedShortlist')!.setData
  const hidden=toggleLayerVisibility(toggleLayerVisibility(visibility,'autoSelected'),'unselectedShortlist')
  applyRoadMapVisibility(map,hidden)
  expect(map.setLayoutProperty).toHaveBeenCalledWith('autoSelected','visibility','none')
  expect(map.setLayoutProperty).toHaveBeenCalledWith('autoSelected-hit','visibility','none')
  expect(map.setLayoutProperty).toHaveBeenCalledWith('unselectedShortlist','visibility','none')
  expect(map.setLayoutProperty).toHaveBeenCalledWith('unselectedShortlist-hit','visibility','none')
  expect(auto).not.toHaveBeenCalled();expect(shortlist).not.toHaveBeenCalled()
  map.setLayoutProperty.mockClear();applyRoadMapVisibility(map,visibility)
  expect(map.setLayoutProperty).toHaveBeenCalledWith('autoSelected','visibility','visible')
  expect(map.setLayoutProperty).toHaveBeenCalledWith('autoSelected-hit','visibility','visible')
 })
 it('respects hidden state when a source and its hit layer are created after data arrives',()=>{
  const{map}=fakeMap(),hidden=toggleLayerVisibility(initialLayerVisibility(),'autoSelected')
  synchronizeRoadMapData(map,{autoSelected:collection('A')},hidden,{} as never,()=>{})
  expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id:'autoSelected',layout:{visibility:'none'}}))
  expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id:'autoSelected-hit',layout:{visibility:'none'}}))
 })
 it('creates enlarged invisible hit targets for continuity points',()=>{
  const{map}=fakeMap()
  synchronizeRoadMapData(map,{continuityGaps:collection('gap'),continuityChecks:collection('check')},initialLayerVisibility(),{} as never,()=>{})
  expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id:'continuityGaps-hit',type:'circle',paint:{'circle-radius':16,'circle-opacity':0}}))
  expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id:'continuityChecks-hit',type:'circle',paint:{'circle-radius':16,'circle-opacity':0}}))
 })
 it('removes known legacy review layers and sources left by Fast Refresh',()=>{
  const{map,layers,sources}=fakeMap()
  for(const id of ['selected','selected-hit','candidates','candidates-hit','rejected'])layers.add(id)
  for(const id of ['selected','candidates','rejected'])sources.set(id,{setData:vi.fn()})
  removeLegacyRoadBuilderLayers(map)
  expect(map.removeLayer.mock.calls.map(call=>call[0])).toEqual(['selected-hit','candidates-hit','selected','candidates','rejected'])
  expect(map.removeSource.mock.calls.map(call=>call[0])).toEqual(['selected','candidates','rejected'])
 })
})
