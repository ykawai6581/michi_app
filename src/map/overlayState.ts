import type{LayerVisibility,PointOverlayStyle}from'../types/geo'
export const initialLayerVisibility=():LayerVisibility=>({basemap:'presentation',darkBasemap:false,modernRoads:false,railways:false,stations:false,historicalRoads:false,historicalPosts:false,jurisdictions:false})
export const initialPointOverlayStyle=():PointOverlayStyle=>({stations:{radius:2},historicalPosts:{radius:2.5}})
