/* eslint-disable react-refresh/only-export-components */
import React,{useCallback,useEffect,useRef,useState} from 'react'
import{createRoot}from'react-dom/client'
import maplibregl,{GeoJSONSource,Map as MlMap}from'maplibre-gl'
import'maplibre-gl/dist/maplibre-gl.css'
import'./style.css'
import{applyStatutoryNetworkChoice,atomIdsIntersectingBounds,canBuild,canConnect,diagnosticLayerIds,DiagnosticLayerId,deletionApiPaths,deletionConfirmation,emptyDiagnosticState,emptyManualSelection,emptyRoad,excludeManualAtoms,initialLayerVisibility,LayerVisibility,ManualSelection,PreviewStage,previewStageAfterManualEdit,removeAt,resolveDeletableRoad,Road,SelectionBounds,statutoryNetworkChoice,toggle,toggleLayerVisibility,toggleManualAtom,uniqueAdd}from'./model'
import ProjectEditor from'./ProjectEditor'
import BuilderMap from'./BuilderMap'
import{initialProjectVisibility,ProjectLayer}from'./projectModel'
import{PreviewProgress,PreviewProgressIndicator,previewDraftIsCurrent}from'./previewProgress'

type FC=GeoJSON.FeatureCollection
type DiagnosticLayers=Partial<Record<DiagnosticLayerId,FC>>
type AnalysisRow={class:string;nearbyFeatures:number;residualPassFeatures:number;matchedLengthMeters:number;medianResidualMeters:number|null;suggested:boolean}
type Meta={classes:{value:string,label:string}[];availableClasses:string[];missingClasses:string[];n13SourceFingerprint?:string}
type MatchPreviewResult={previewId:string;draftHash:string;reference:FC;referenceExcluded:FC;candidates:FC;selected:FC;diagnostics:FC;ownership:FC}
type ConnectedPreviewResult={finalPreviewId:string;selected:FC;n13SourceFingerprint?:string}
type ManualHistoryEntry={selection:ManualSelection;regionCount:number}


const layerPaint:Record<DiagnosticLayerId,Record<string,unknown>>={
  rejected:{'line-color':'#777','line-width':2,'line-opacity':.25},
  candidates:{'line-color':['match',['get','manualSelection'],'exclude','#777','include','#00a7c4','#da8a18'],'line-width':3,'line-opacity':['case',['==',['get','manualSelection'],'exclude'],.3,.65],'line-dasharray':['case',['==',['get','manualSelection'],'exclude'],['literal',[2,2]],['literal',[1,0]]]},
  referenceExcluded:{'line-color':'#c65d16','line-width':4,'line-opacity':.7,'line-dasharray':[1,2]},
  reference:{'line-color':'#1677ff','line-width':3,'line-opacity':.85,'line-dasharray':[2,2]},
  ownership:{'circle-color':['match',['get','ownershipClass'],'1','#2e7d32','2','#f9a825','3','#8e24aa','#666'],'circle-radius':4,'circle-stroke-color':'white','circle-stroke-width':1},
  selected:{'line-color':['match',['get','manualSelection'],'exclude','#777','include','#00a7c4','#d92727'],'line-width':5,'line-opacity':['case',['==',['get','manualSelection'],'exclude'],.35,.9],'line-dasharray':['case',['==',['get','manualSelection'],'exclude'],['literal',[2,2]],['literal',[1,0]]]},
}

const api=async(path:string,method='GET',body?:unknown)=>{
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  const value=await response.json()
  if(!response.ok)throw new Error(value.error?.message||'Request failed')
  return value
}

function coordinatesOf(value:unknown,result:[number,number][]=[]):[number,number][]{
  if(Array.isArray(value)){
    if(value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number')result.push([value[0],value[1]])
    else value.forEach(item=>coordinatesOf(item,result))
  }
  return result
}

function fitGeoJson(map:MlMap,data:FC|undefined){
  if(!data)return
  const coordinates=data.features.flatMap(feature=>coordinatesOf(feature.geometry&&'coordinates'in feature.geometry?feature.geometry.coordinates:undefined))
  if(!coordinates.length)return
  const bounds=coordinates.slice(1).reduce((box,coordinate)=>box.extend(coordinate),new maplibregl.LngLatBounds(coordinates[0],coordinates[0]))
  map.fitBounds(bounds,{padding:64,maxZoom:16,duration:500})
}

function List({values,onChange}:{values:string[],onChange:(values:string[])=>void}){
  const[input,setInput]=useState('')
  return <div>{values.map((value,index)=><span className="chip" key={value}>{value}<button onClick={()=>onChange(removeAt(values,index))}>×</button></span>)}<div><input value={input} onChange={event=>setInput(event.target.value)}/><button onClick={()=>{onChange(uniqueAdd(values,input));setInput('')}}>+ Add</button></div></div>
}

const rectangleFeature=(bounds:SelectionBounds):GeoJSON.Feature<GeoJSON.Polygon>=>{const[west,south,east,north]=bounds;return{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}}}

function Map({layers,visibility,fitVersion,onFeature,excludeRegionMode,exclusionRegions,onExcludeRegion}:{layers:DiagnosticLayers;visibility:LayerVisibility;fitVersion:number;onFeature:(properties:object,layer:DiagnosticLayerId)=>void;excludeRegionMode:boolean;exclusionRegions:FC;onExcludeRegion:(bounds:SelectionBounds,rectangle:GeoJSON.Feature<GeoJSON.Polygon>)=>void}){
  const node=useRef<HTMLDivElement>(null)
  const map=useRef<MlMap|null>(null)
  const layersRef=useRef(layers)
  const visibilityRef=useRef(visibility)
  const onFeatureRef=useRef(onFeature)
  const regionModeRef=useRef(excludeRegionMode)
  const exclusionRegionsRef=useRef(exclusionRegions)
  const onExcludeRegionRef=useRef(onExcludeRegion)
  layersRef.current=layers
  visibilityRef.current=visibility
  onFeatureRef.current=onFeature
  regionModeRef.current=excludeRegionMode
  exclusionRegionsRef.current=exclusionRegions
  onExcludeRegionRef.current=onExcludeRegion

  useEffect(()=>{
    if(!node.current)return
    const instance=new maplibregl.Map({
      container:node.current,
      style:{
        version:8,
        sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},
        layers:[{id:'osm-basemap',type:'raster',source:'osm'}],
      },
      center:[139.7,35.68],zoom:9,
    })
    map.current=instance
    instance.addControl(new maplibregl.NavigationControl())
    let regionStart:[number,number]|undefined
    const regionData=(temporary?:GeoJSON.Feature<GeoJSON.Polygon>):FC=>({type:'FeatureCollection',features:[...exclusionRegionsRef.current.features,...(temporary?[temporary]:[])]})
    const updateRegionSource=(temporary?:GeoJSON.Feature<GeoJSON.Polygon>)=>(instance.getSource('exclusion-regions')as GeoJSONSource|undefined)?.setData(regionData(temporary))
    const cancelRegion=()=>{regionStart=undefined;instance.dragPan.enable();updateRegionSource()}
    const onMouseDown=(event:maplibregl.MapMouseEvent)=>{
      if(!regionModeRef.current||event.originalEvent.button!==0)return
      event.preventDefault();regionStart=[event.lngLat.lng,event.lngLat.lat];instance.dragPan.disable()
      updateRegionSource(rectangleFeature([regionStart[0],regionStart[1],regionStart[0],regionStart[1]]))
    }
    const onMouseMove=(event:maplibregl.MapMouseEvent)=>{
      if(!regionStart)return
      updateRegionSource(rectangleFeature([regionStart[0],regionStart[1],event.lngLat.lng,event.lngLat.lat]))
    }
    const onMouseUp=(event:maplibregl.MapMouseEvent)=>{
      if(!regionStart)return
      const bounds:SelectionBounds=[regionStart[0],regionStart[1],event.lngLat.lng,event.lngLat.lat]
      const normalized:SelectionBounds=[Math.min(bounds[0],bounds[2]),Math.min(bounds[1],bounds[3]),Math.max(bounds[0],bounds[2]),Math.max(bounds[1],bounds[3])]
      const rectangle=rectangleFeature(normalized);regionStart=undefined;instance.dragPan.enable();updateRegionSource()
      if(normalized[0]!==normalized[2]&&normalized[1]!==normalized[3])onExcludeRegionRef.current(normalized,rectangle)
    }
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&regionStart)cancelRegion()}
    instance.on('mousedown',onMouseDown);instance.on('mousemove',onMouseMove);instance.on('mouseup',onMouseUp);window.addEventListener('keydown',onKeyDown)
    const synchronize=()=>{
      if(!instance.getSource('exclusion-regions')){
        instance.addSource('exclusion-regions',{type:'geojson',data:regionData()})
        instance.addLayer({id:'exclusion-regions-fill',type:'fill',source:'exclusion-regions',paint:{'fill-color':'#6c4cff','fill-opacity':.14}})
        instance.addLayer({id:'exclusion-regions-outline',type:'line',source:'exclusion-regions',paint:{'line-color':'#6c4cff','line-width':2,'line-dasharray':[2,1]}})
      }
      diagnosticLayerIds.forEach(id=>{
        const data=layersRef.current[id]
        if(!data)return
        const source=instance.getSource(id)as GeoJSONSource|undefined
        if(source)source.setData(data)
        else{
          instance.addSource(id,{type:'geojson',data})
          instance.addLayer({id,type:id==='ownership'?'circle':'line',source:id,layout:{visibility:visibilityRef.current[id]?'visible':'none'},paint:layerPaint[id]} as maplibregl.LayerSpecification)
          if(id==='selected'||id==='candidates'){
            instance.addLayer({id:`${id}-hit`,type:'line',source:id,...(id==='candidates'?{filter:['!=',['get','automaticSelection'],true]}:{}),paint:{'line-color':'#000','line-width':14,'line-opacity':0}} as maplibregl.LayerSpecification)
            instance.on('click',`${id}-hit`,event=>{if(event.features?.[0])onFeatureRef.current(event.features[0].properties||{},id)})
          }else instance.on('click',id,event=>{if(event.features?.[0])onFeatureRef.current(event.features[0].properties||{},id)})
        }
      })
      diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.moveLayer(id)})
    }
    instance.once('load',synchronize)
    return()=>{window.removeEventListener('keydown',onKeyDown);instance.remove();map.current=null}
  },[])

  useEffect(()=>{
    const instance=map.current;if(!instance)return
    const update=()=>{instance.getCanvas().style.cursor=excludeRegionMode?'crosshair':'';(instance.getSource('exclusion-regions')as GeoJSONSource|undefined)?.setData(exclusionRegions)}
    if(instance.loaded())update();else instance.once('load',update)
  },[excludeRegionMode,exclusionRegions])

  useEffect(()=>{
    const instance=map.current
    if(!instance)return
    const synchronize=()=>diagnosticLayerIds.forEach(id=>{
      const data=layers[id]
      if(!data)return
      const source=instance.getSource(id)as GeoJSONSource|undefined
      if(source)source.setData(data)
      else{
        instance.addSource(id,{type:'geojson',data})
        instance.addLayer({id,type:id==='ownership'?'circle':'line',source:id,layout:{visibility:visibility[id]?'visible':'none'},paint:layerPaint[id]} as maplibregl.LayerSpecification)
        if(id==='selected'||id==='candidates'){
          instance.addLayer({id:`${id}-hit`,type:'line',source:id,...(id==='candidates'?{filter:['!=',['get','automaticSelection'],true]}:{}),paint:{'line-color':'#000','line-width':14,'line-opacity':0}} as maplibregl.LayerSpecification)
          instance.on('click',`${id}-hit`,event=>{if(event.features?.[0])onFeatureRef.current(event.features[0].properties||{},id)})
        }else instance.on('click',id,event=>{if(event.features?.[0])onFeatureRef.current(event.features[0].properties||{},id)})
      }
    })
    const synchronizeInOrder=()=>{synchronize();diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.moveLayer(id)})}
    if(instance.loaded())synchronizeInOrder();else instance.once('load',synchronizeInOrder)
  },[layers,visibility])

  useEffect(()=>{
    const instance=map.current
    if(!instance)return
    const update=()=>diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.setLayoutProperty(id,'visibility',layers[id]&&visibility[id]?'visible':'none');if(instance.getLayer(`${id}-hit`))instance.setLayoutProperty(`${id}-hit`,'visibility',layers[id]&&visibility[id]?'visible':'none')})
    if(instance.loaded())update();else instance.once('load',update)
  },[layers,visibility])

  useEffect(()=>{
    if(!fitVersion)return
    const instance=map.current
    if(!instance)return
    const fit=()=>fitGeoJson(instance,layers.reference||layers.selected||layers.candidates||layers.rejected)
    if(instance.loaded())fit();else instance.once('load',fit)
  },[fitVersion,layers])

  return <div ref={node} className="map"/>
}

function App(){
  const[mode,setMode]=useState<'roads'|'projects'>('roads')
  const[projectLayers,setProjectLayers]=useState<Partial<Record<ProjectLayer,FC>>>({})
  const[projectBounds,setProjectBounds]=useState<[number,number,number,number]>()
  const[projectVisibility,setProjectVisibility]=useState(initialProjectVisibility())
  const[roads,setRoads]=useState<Road[]>([])
  const[road,setRoad]=useState(emptyRoad())
  const[editing,setEditing]=useState<string>()
  const[meta,setMeta]=useState<Meta>({classes:[],availableClasses:[],missingClasses:[]})
  const[status,setStatus]=useState('Ready')
  const[error,setError]=useState('')
  const[analysis,setAnalysis]=useState<{classes:AnalysisRow[]}>()
  const[discovered,setDiscovered]=useState<string[]>([])
  const[layers,setLayers]=useState<DiagnosticLayers>({})
  const[visibility,setVisibility]=useState(initialLayerVisibility())
  const[fitVersion,setFitVersion]=useState(0)
  const[picked,setPicked]=useState<object>({})
  const[previewId,setPreviewId]=useState<string>()
  const[finalPreviewId,setFinalPreviewId]=useState<string>()
  const[previewStage,setPreviewStage]=useState<PreviewStage>('NO_MATCH')
  const[manualSelection,setManualSelection]=useState<ManualSelection>(emptyManualSelection())
  const[manualHistory,setManualHistory]=useState<ManualHistoryEntry[]>([])
  const[editSelection,setEditSelection]=useState(false)
  const[excludeRegionMode,setExcludeRegionMode]=useState(false)
  const[exclusionRegions,setExclusionRegions]=useState<FC>({type:'FeatureCollection',features:[]})
  const[previewDraftHash,setPreviewDraftHash]=useState<string>()
  const[previewIsCurrent,setPreviewIsCurrent]=useState(false)
  const[previewProgress,setPreviewProgress]=useState<PreviewProgress>()
  const roadRef=useRef(road)
  useEffect(()=>{roadRef.current=road},[road])
  const onFeature=useCallback((properties:object,layer?:DiagnosticLayerId)=>{
    setPicked(properties)
    if(!editSelection||(layer!=='selected'&&layer!=='candidates'))return
    const atomId=String((properties as Record<string,unknown>).n13AtomId||'')
    if(!atomId)return
    setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length}])
    setManualSelection(toggleManualAtom(manualSelection,atomId,Boolean((properties as Record<string,unknown>).automaticSelection)))
    setFinalPreviewId(undefined);setPreviewStage(stage=>previewStageAfterManualEdit(stage))
  },[editSelection,exclusionRegions.features.length,manualSelection])
  const excludeRegion=useCallback((bounds:SelectionBounds,rectangle:GeoJSON.Feature<GeoJSON.Polygon>)=>{
    const candidates=layers.candidates;if(!candidates)return
    const atomIds=atomIdsIntersectingBounds(candidates,bounds)
    if(atomIds.length){
      setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length}])
      setManualSelection(excludeManualAtoms(manualSelection,atomIds))
      setExclusionRegions(current=>({...current,features:[...current.features,rectangle]}))
      setFinalPreviewId(undefined);setPreviewStage(stage=>previewStageAfterManualEdit(stage));setStatus(`Excluded ${atomIds.length} shortlisted N13 atom${atomIds.length===1?'':'s'} in region.`)
    }
    setExcludeRegionMode(false)
  },[layers.candidates,exclusionRegions.features.length,manualSelection])
  const reload=()=>Promise.all([api('/api/roads'),api('/api/metadata')]).then(([roadsResult,metadata])=>{setRoads(roadsResult.roads);setMeta(metadata)})
  useEffect(()=>{reload().catch(reason=>setError(reason.message))},[])
  const change=(patch:Partial<Road>)=>{setRoad(current=>({...current,...patch}));setPreviewIsCurrent(false);setPreviewStage('NO_MATCH');setPreviewId(undefined);setFinalPreviewId(undefined)}
  const clearDiagnostics=()=>{const cleared=emptyDiagnosticState();setLayers(cleared.layers);setAnalysis(cleared.analysis);setDiscovered(cleared.discovered);setPicked(cleared.picked)}
  const invalidatePreview=()=>{setPreviewId(undefined);setFinalPreviewId(undefined);setPreviewDraftHash(undefined);setPreviewIsCurrent(false);setPreviewStage('NO_MATCH');setExclusionRegions({type:'FeatureCollection',features:[]});setExcludeRegionMode(false)}
  const newRoad=()=>{setRoad(emptyRoad());setEditing(undefined);clearDiagnostics();invalidatePreview();setStatus('Ready');setError('')}
  const registeredRoad=resolveDeletableRoad(roads,road.id,editing)
  const act=async(label:string,path:string,body:unknown={road})=>{
    setStatus(label+'…');setError('')
    try{
      const result=await api(path,'POST',body)
      const hasGeometry=Boolean(result.reference||result.selected||result.candidates||result.diagnostics)
      setLayers(current=>({
        ...current,
        ...(result.reference?{reference:result.reference}:{}),
        ...(result.referenceExcluded?{referenceExcluded:result.referenceExcluded}:{}),
        ...(result.candidates?{candidates:result.candidates}:{}),
        ...(result.selected?{selected:result.selected}:{}),
        ...(result.diagnostics?{rejected:result.diagnostics}:{}),...(result.ownership?{ownership:result.ownership}:{}),
      }))
      if(hasGeometry)setFitVersion(version=>version+1)
      if(result.discoveredNames)setDiscovered(result.discoveredNames)
      if(result.classes)setAnalysis(result)
      if(path==='/api/match/preview'){setPreviewId(result.previewId);setPreviewDraftHash(result.draftHash);setPreviewIsCurrent(true)}
      setStatus(label+' complete')
      return result
    }catch(reason){setError((reason as Error).message);setStatus(label+' failed')}
  }
  const applyPreview=(result:MatchPreviewResult)=>{
    setLayers(current=>({...current,reference:result.reference,referenceExcluded:result.referenceExcluded,
      candidates:result.candidates,selected:result.selected,rejected:result.diagnostics,ownership:result.ownership}))
    setFitVersion(version=>version+1)
  }
  const previewMatch=async()=>{
    const submitted=JSON.stringify(road)
    setError('');setStatus(layers.selected?'Previewing new match…':'Previewing match…')
    setPreviewProgress({status:'running',progress:0,phase:'Preparing reference'});setPreviewIsCurrent(false);setPreviewStage('MATCH_RUNNING');setFinalPreviewId(undefined)
    try{
      const started=await api('/api/match/preview/start','POST',{road})
      for(;;){
        await new Promise(resolve=>setTimeout(resolve,350))
        const job=await api(`/api/jobs/${started.jobId}`) as PreviewProgress&{result:MatchPreviewResult;error?:{message:string}}
        setPreviewProgress(job)
        if(job.status==='running')continue
        if(job.status==='failed')throw new Error(job.error?.message||'Preview failed')
        if(!previewDraftIsCurrent(submitted,roadRef.current)){setStatus('Preview completed for previous settings');return}
        applyPreview(job.result);setPreviewId(job.result.previewId);setPreviewDraftHash(job.result.draftHash)
        const savedSelection=road.manualSelectionN13Fingerprint===meta.n13SourceFingerprint?road.manualSelection:undefined
        setManualSelection(savedSelection||emptyManualSelection());setManualHistory([])
        setExclusionRegions({type:'FeatureCollection',features:[]});setExcludeRegionMode(false)
        setPreviewIsCurrent(true);setPreviewStage('MATCH_READY');setStatus('Match preview ready ✓');return
      }
    }catch(reason){setError((reason as Error).message);setStatus('Preview failed');setPreviewStage('NO_MATCH');setPreviewProgress(current=>current?{...current,status:'failed',phase:'Preview failed'}:undefined)}
  }
  const connectSelected=async()=>{
    if(!previewId)return
    setError('');setStatus('Connecting selected segments…');setPreviewStage('CONNECT_RUNNING')
    setPreviewProgress({status:'running',progress:0,phase:'Preparing curated selection'})
    try{
      const started=await api(`/api/match/previews/${previewId}/connect/start`,'POST',{road,manualSelection})
      for(;;){
        await new Promise(resolve=>setTimeout(resolve,250))
        const job=await api(`/api/jobs/${started.jobId}`) as PreviewProgress&{result:ConnectedPreviewResult;error?:{message:string}}
        setPreviewProgress(job);if(job.status==='running')continue
        if(job.status==='failed')throw new Error(job.error?.message||'Connection failed')
        setLayers(current=>({...current,selected:job.result.selected}));setFinalPreviewId(job.result.finalPreviewId)
        setRoad(current=>({...current,manualSelection,manualSelectionN13Fingerprint:job.result.n13SourceFingerprint}));setPreviewStage('FINAL_READY');setStatus('Connected preview ready ✓');return
      }
    }catch(reason){setError((reason as Error).message);setStatus('Connection failed');setPreviewStage('MATCH_EDITED')}
  }
  const deleteRoad=async()=>{
    const target=registeredRoad
    if(!target)return
    try{
      const paths=deletionApiPaths(target.id)
      const referenceResult=await api(paths.references)
      const references=(referenceResult.referencedByProjects||[])as {id:string;displayName:string}[]
      if(!window.confirm(deletionConfirmation(target,references)))return
      const result=await api(paths.delete,'DELETE')
      newRoad();await reload();setStatus(`Deleted ${result.roadId}. You can now recreate this road.`)
      if(result.referencedByProjects?.length)setError('Referenced project configs were not modified and will fail to build until the road is recreated.')
    }catch(reason){setError((reason as Error).message);setStatus('Delete failed')}
  }
  const save=async(build=false)=>{
    setStatus('Saving…');setError('')
    try{
      if(build){
        if(!finalPreviewId||!canBuild(previewStage,finalPreviewId))throw new Error('Final preview is stale; run Connect Selected again.')
        await api(`/api/roads/${road.id}/build`,'POST',{previewId:finalPreviewId,road:{...road,manualSelection}})
        setEditing(road.id);await reload();setStatus('Saved & built from current preview.')
      }else{
        await api(editing?`/api/roads/${editing}`:'/api/roads',editing?'PUT':'POST',{road})
        setEditing(road.id);await reload();setStatus('Road saved')
      }
    }catch(reason){setError((reason as Error).message);setStatus('Save failed')}
  }

  const displayedLayers:DiagnosticLayers={...layers}
  for(const id of ['selected','candidates'] as const){
    const data=layers[id]
    if(data)displayedLayers[id]={...data,features:data.features.map(feature=>{
      const properties={...(feature.properties||{})} as Record<string,unknown>,atom=String(properties.n13AtomId||'')
      const excluded=manualSelection.exclude.includes(atom),included=manualSelection.include.includes(atom)
      properties.manualSelection=excluded?'exclude':included?'include':'none'
      properties.finalCuratedSelection=excluded?false:included||Boolean(properties.automaticSelection)
      properties.selectionReason=excluded?'rejected-manual':included?'accepted-manual':properties.automaticSelection?'accepted-auto':'rejected-auto'
      return{...feature,properties}
    })}
  }

  return <><nav className="modeTabs"><button className={mode==='roads'?'active':''} onClick={()=>setMode('roads')}>Roads</button><button className={mode==='projects'?'active':''} onClick={()=>setMode('projects')}>Projects</button></nav><main>{mode==='roads'?<><section className="editor"><header><h1>Road Builder</h1><b>LOCAL DEVELOPMENT TOOL ONLY</b></header><div className="toolbar"><button onClick={newRoad}>New road</button><select value={editing||''} onChange={async event=>{if(!event.target.value)return;const result=await api(`/api/roads/${event.target.value}`);setRoad(result.road);setEditing(event.target.value);clearDiagnostics();invalidatePreview()}}><option value="">Load existing road…</option>{roads.map(item=><option key={item.id} value={item.id}>{item.displayName} — {item.id}</option>)}</select>{registeredRoad&&<button className="destructive" onClick={deleteRoad}>Delete Road…</button>}</div><label>Canonical ID<input value={road.id} onChange={event=>change({id:event.target.value})}/>{registeredRoad&&<small className="registered-notice">Registered road</small>}</label><label>Display name<input value={road.displayName} onChange={event=>change({displayName:event.target.value})}/></label><fieldset><legend>Entity type</legend>{(['statutory-road','named-road']as const).map(type=><label className="inline" key={type}><input type="radio" checked={road.entityType===type} onChange={()=>change({entityType:type,reference:type==='named-road'?{type:'osm-name',names:[],tags:['name','name:ja','name:en','alt_name']}:{type:'osm-ref',ref:''}})}/>{type}</label>)}</fieldset><label>Jurisdiction<input value={road.jurisdiction} onChange={event=>change({jurisdiction:event.target.value})}/></label><label>Aliases<List values={road.aliases} onChange={aliases=>change({aliases})}/></label>{road.entityType==='named-road'?<><label>OSM names<List values={road.reference.names||[]} onChange={names=>change({reference:{...road.reference,names}})}/></label><fieldset><legend>OSM exact-name tags</legend>{['name','name:ja','name:en','alt_name'].map(tag=><label className="inline" key={tag}><input type="checkbox" checked={(road.reference.tags||[]).includes(tag)} onChange={()=>change({reference:{...road.reference,tags:toggle(road.reference.tags||[],tag)}})}/>{tag}</label>)}</fieldset></>:<><label>OSM ref<input value={road.reference.ref||''} onChange={event=>change({reference:{...road.reference,ref:event.target.value}})}/></label><fieldset><legend>Road network</legend>{(['national','prefectural','custom'] as const).map(choice=><label className="inline" key={choice}><input type="radio" checked={statutoryNetworkChoice(road.reference.network)===choice} onChange={()=>change({reference:applyStatutoryNetworkChoice(road.reference,choice),roadClass:choice==='custom'?road.roadClass:choice})}/>{choice[0].toUpperCase()+choice.slice(1)}</label>)}</fieldset><label>OSM network<input placeholder="JP:national" value={road.reference.network||''} onChange={event=>change({reference:{...road.reference,network:event.target.value}})}/></label><label>Exclude segment names from reference (exact match)<List values={road.reference.excludeNames||[]} onChange={excludeNames=>change({reference:{...road.reference,excludeNames}})}/></label></>}<fieldset><legend>N13 candidate classifications</legend>{meta.classes.map(item=><label className="class" title={item.label} key={item.value}><input type="checkbox" checked={road.n13.classifications.includes(item.value)} onChange={()=>change({n13:{...road.n13,classifications:toggle(road.n13.classifications,item.value)}})}/>{item.value} — {item.label}{meta.missingClasses.includes(item.value)&&' (cache missing)'}</label>)}</fieldset><details><summary>Advanced matching settings</summary>{Object.entries(road.matching||{}).map(([key,value])=><label key={key}>{key}<input type="number" value={value} onChange={event=>change({matching:{...road.matching,[key]:Number(event.target.value)}})}/></label>)}{road.networkSelection&&Object.entries(road.networkSelection).map(([key,value])=><label key={key}>{key}<input type="number" value={value} onChange={event=>change({networkSelection:{...road.networkSelection,[key]:Number(event.target.value)}})}/></label>)}</details><div className="actions"><button onClick={()=>act('Inspecting OSM','/api/osm/inspect')}>Inspect OSM</button><button onClick={()=>act('Analyzing N13','/api/n13/analyze')}>Analyze N13</button><button disabled={previewProgress?.status==='running'} onClick={previewMatch}>{previewProgress?.status==='running'?'Previewing…':'Preview Match'}</button><button disabled={!canConnect(previewStage)||previewStage==='CONNECT_RUNNING'} onClick={connectSelected}>Connect Selected</button><button onClick={()=>save(false)}>{editing?'Save changes':'Save Road'}</button><button className="primary" disabled={!canBuild(previewStage,finalPreviewId)} onClick={()=>save(true)}>Save &amp; Build</button></div>{previewProgress&&<PreviewProgressIndicator value={previewProgress}/>}<p className={previewIsCurrent?'preview-current':'preview-stale'}>{previewStage==='FINAL_READY'?`Final connected preview current ✓ (${finalPreviewId?.slice(0,8)})`:previewIsCurrent?`Match preview ready ✓ (${previewDraftHash?.slice(0,8)}). Review selection, then run Connect Selected.`:'Preview out of date — run Preview Match again.'}</p><div className="selectionControls"><button className={editSelection?'active':''} disabled={!previewIsCurrent} onClick={()=>{setEditSelection(value=>!value);setExcludeRegionMode(false)}}>Edit Selection</button><button className={excludeRegionMode?'active':''} disabled={!previewIsCurrent} onClick={()=>{setExcludeRegionMode(value=>!value);setEditSelection(false)}}>Exclude Region</button><button disabled={!manualHistory.length} onClick={()=>{const previous=manualHistory.at(-1);if(previous){setManualSelection(previous.selection);setExclusionRegions(current=>({...current,features:current.features.slice(0,previous.regionCount)}));setManualHistory(history=>history.slice(0,-1));setFinalPreviewId(undefined);setPreviewStage('MATCH_EDITED')}}}>Undo</button><button disabled={!manualSelection.include.length&&!manualSelection.exclude.length} onClick={()=>{setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length}]);setManualSelection(emptyManualSelection());setExclusionRegions({type:'FeatureCollection',features:[]});setFinalPreviewId(undefined);setPreviewStage('MATCH_EDITED')}}>Clear manual edits</button>{editSelection&&<small>Click selected road to exclude. Click shortlisted candidate to include.</small>}{excludeRegionMode&&<small>Drag a rectangle over shortlisted N13 atoms to exclude them. Press Escape to cancel a drag.</small>}</div>{road.manualSelection&&(road.manualSelection.include.length>0||road.manualSelection.exclude.length>0)&&road.manualSelectionN13Fingerprint!==meta.n13SourceFingerprint&&<p className="error">Manual N13 edits are stale because the N13 source changed. Review them again. <button onClick={()=>setRoad(current=>({...current,manualSelection:emptyManualSelection(),manualSelectionN13Fingerprint:undefined}))}>Clear stale edits</button></p>}<p>Automatic selected: {layers.selected?.features.length||0} · Manual inclusions: {manualSelection.include.length} · Manual exclusions: {manualSelection.exclude.length} · Exclusion regions: {exclusionRegions.features.length}</p><p className="status">{status}</p>{error&&<p className="error">{error}</p>}{discovered.length>0&&<section><h3>Detected OSM segment names</h3>{road.entityType==='named-road'?discovered.map(name=><label className="class" key={name}><input type="checkbox" checked={(road.reference.names||[]).includes(name)} onChange={()=>change({reference:{...road.reference,names:toggle(road.reference.names||[],name)}})}/>{name}</label>):<><p className="hint">Exclude segment names from reference (exact match)</p>{discovered.map(name=><label className="class" key={name}><input type="checkbox" checked={(road.reference.excludeNames||[]).includes(name)} onChange={()=>change({reference:{...road.reference,excludeNames:toggle(road.reference.excludeNames||[],name)}})}/>{name}</label>)}</>}</section>}{road.entityType==='statutory-road'&&(road.reference.excludeNames||[]).length>0&&<p className="identityWarning">This statutory reference is filtered and does not represent every current segment of the statutory route.</p>}<p>Available cached classes: {meta.availableClasses.join(' ')||'none'}<br/>Missing supported classes: {meta.missingClasses.join(' ')||'none'}</p>{meta.missingClasses.filter(item=>road.n13.classifications.includes(item)).map(item=><button key={item} onClick={async()=>{await act(`Preparing class ${item}`,'/api/n13/prepare',{class:item});reload()}}>Prepare class {item}</button>)}{analysis&&<table><thead><tr><th>Class</th><th>Nearby</th><th>Residual pass</th><th>Length</th><th>Median</th></tr></thead><tbody>{analysis.classes.map(item=><tr className={item.suggested?'suggested':''} key={item.class}><td>{item.class}</td><td>{item.nearbyFeatures}</td><td>{item.residualPassFeatures}</td><td>{(item.matchedLengthMeters/1000).toFixed(2)} km</td><td>{item.medianResidualMeters??'–'}</td></tr>)}</tbody></table>}</section><section className="mapPane"><div className="layers">{(['reference','referenceExcluded','ownership','selected','candidates','rejected']as DiagnosticLayerId[]).map(id=><label key={id}><input type="checkbox" checked={visibility[id]} onChange={()=>setVisibility(current=>toggleLayerVisibility(current,id))}/>{id}</label>)}</div><Map layers={displayedLayers} visibility={visibility} fitVersion={fitVersion} onFeature={onFeature} excludeRegionMode={excludeRegionMode} exclusionRegions={exclusionRegions} onExcludeRegion={excludeRegion}/><pre>{JSON.stringify(picked,null,2)}</pre></section></>:<><ProjectEditor visibility={projectVisibility} onVisibility={setProjectVisibility} onPreview={value=>{setProjectLayers(value.layers);setProjectBounds(value.manifest.bounds);setPicked({})}} onClearPreview={()=>{setProjectLayers({});setProjectBounds(undefined);setPicked({})}}/><section className="mapPane"><BuilderMap layers={projectLayers} visibility={projectVisibility} bounds={projectBounds} onFeature={onFeature}/><pre>{JSON.stringify(picked,null,2)}</pre></section></>}</main></>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
