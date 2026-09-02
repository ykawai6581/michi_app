import{describe,expect,it,vi}from'vitest'
import{canBuild,emptyRoad,initialLayerVisibility,toggleManualAtom}from'./model'
import{connectedPreviewState,finalReadyVisibility,reviewVisibility,startConnectSelected}from'./roadWorkflow'

describe('manual include through Connect Selected',()=>{
 it('sends the current clicked shortlist inclusion in the actual connect request',async()=>{
  const road={...emptyRoad(),id:'test',displayName:'Test'},request=vi.fn().mockResolvedValue({jobId:'job'})
  const manualSelection=toggleManualAtom({include:[],exclude:[]},'B',false)
  expect(manualSelection).toEqual({include:['B'],exclude:[]})
  await startConnectSelected(request,'match-preview',road,manualSelection)
  expect(request).toHaveBeenCalledWith('/api/match/previews/match-preview/connect/start','POST',{
    road,manualSelection:{include:['B'],exclude:[]}})
 })
 it('keeps manual state while presenting the returned A+B final layer as FINAL_READY',()=>{
  const manualSelection={include:['B'],exclude:[]},finalConnected={features:[{id:'A'},{id:'B'}]}
  const completed=connectedPreviewState({finalPreviewId:'final-preview',selected:finalConnected},manualSelection)
  const visibility=finalReadyVisibility(initialLayerVisibility())
  expect(completed.manualSelection.include).toEqual(['B'])
  expect(completed.finalConnected.features.map(item=>item.id)).toEqual(['A','B'])
  expect(completed.stage).toBe('FINAL_READY')
  expect(visibility).toMatchObject({finalConnected:true,autoSelected:false,unselectedShortlist:false,manuallyIncluded:false})
  expect(canBuild('FINAL_READY','final-preview')).toBe(true)
  expect(reviewVisibility(visibility)).toMatchObject({finalConnected:false,autoSelected:true,unselectedShortlist:true,manuallyIncluded:true})
 })
})
