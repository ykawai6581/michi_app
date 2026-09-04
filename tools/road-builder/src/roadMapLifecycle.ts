import type maplibregl from'maplibre-gl'
import type{GeoJSONSource,Map as MlMap}from'maplibre-gl'
import{diagnosticLayerIds,DiagnosticLayerId,LayerVisibility,mapLayerVisibility}from'./model'

type FC=GeoJSON.FeatureCollection
export type DiagnosticLayers=Partial<Record<DiagnosticLayerId,FC>>
const editable=new Set<DiagnosticLayerId>(['autoSelected','unselectedShortlist','manuallyIncluded','manuallyExcluded'])
export const legacyRoadBuilderLayerIds=['selected-hit','candidates-hit','selected','candidates','rejected'] as const

export function removeLegacyRoadBuilderLayers(map:MlMap){
  for(const id of legacyRoadBuilderLayerIds)if(map.getLayer(id))map.removeLayer(id)
  for(const id of ['selected','candidates','rejected'])if(map.getSource(id))map.removeSource(id)
}

export function synchronizeRoadMapData(map:MlMap,layers:DiagnosticLayers,visibility:LayerVisibility,
  paint:Record<DiagnosticLayerId,Record<string,unknown>>,onFeature:(properties:object,layer:DiagnosticLayerId)=>void){
  diagnosticLayerIds.forEach(id=>{
    const data=layers[id]
    if(!data)return
    const source=map.getSource(id)as GeoJSONSource|undefined
    if(source){source.setData(data);return}
    map.addSource(id,{type:'geojson',data})
    map.addLayer({id,type:id==='ownership'||id==='continuityGaps'?'circle':'line',source:id,
      layout:{visibility:mapLayerVisibility(visibility,id)},paint:paint[id]} as maplibregl.LayerSpecification)
    if(editable.has(id)){
      const hit=`${id}-hit`
      map.addLayer({id:hit,type:'line',source:id,layout:{visibility:mapLayerVisibility(visibility,id)},
        paint:{'line-color':'#000','line-width':14,'line-opacity':0}} as maplibregl.LayerSpecification)
      map.on('click',hit,event=>{if(event.features?.[0])onFeature(event.features[0].properties||{},id)})
    }else map.on('click',id,event=>{if(event.features?.[0])onFeature(event.features[0].properties||{},id)})
  })
}

export function applyRoadMapVisibility(map:MlMap,visibility:LayerVisibility){
  diagnosticLayerIds.forEach(id=>{
    const value=visibility[id]?'visible':'none'
    if(map.getLayer(id))map.setLayoutProperty(id,'visibility',value)
    if(map.getLayer(`${id}-hit`))map.setLayoutProperty(`${id}-hit`,'visibility',value)
  })
}
