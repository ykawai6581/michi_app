import type{LayerVisibility,PointOverlayStyle}from'../types/geo'
export const initialLayerVisibility=():LayerVisibility=>({basemap:'presentation',darkBasemap:false,modernRoads:true,railways:false,stations:false,historicalRoads:true,historicalPosts:true,jurisdictions:false})
export const initialPointOverlayStyle=():PointOverlayStyle=>({stations:{radius:2,color:'#42697b'},historicalPosts:{radius:2.5,color:'#b06e3b'}})
