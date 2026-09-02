import type{LayerVisibility,ManualSelection,Road}from'./model'
export type RequestJson=(path:string,method?:string,body?:unknown)=>Promise<unknown>
export const startConnectSelected=(request:RequestJson,matchPreviewId:string,road:Road,manualSelection:ManualSelection)=>
  request(`/api/match/previews/${matchPreviewId}/connect/start`,'POST',{road,manualSelection})
export const finalReadyVisibility=(current:LayerVisibility):LayerVisibility=>({...current,
  autoSelected:false,unselectedShortlist:false,manuallyIncluded:false,manuallyExcluded:false,finalConnected:true})
export const reviewVisibility=(current:LayerVisibility):LayerVisibility=>({...current,
  autoSelected:true,unselectedShortlist:true,manuallyIncluded:true,finalConnected:false})
export const connectedPreviewState=<T>(result:{finalPreviewId:string;selected:T},manualSelection:ManualSelection)=>({
  finalPreviewId:result.finalPreviewId,finalConnected:result.selected,manualSelection,stage:'FINAL_READY' as const})
