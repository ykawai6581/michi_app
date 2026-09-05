/* eslint-disable react-refresh/only-export-components */
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react'
import{createRoot}from'react-dom/client'
import maplibregl,{GeoJSONSource,Map as MlMap}from'maplibre-gl'
import'maplibre-gl/dist/maplibre-gl.css'
import'./style.css'
import{applyGapCandidateEdit,applyStatutoryNetworkChoice,atomIdsIntersectingBounds,canBuild,canConnect,candidatePathGeoJson,ContinuityGap,ContinuitySummary,continuitySummaryText,deriveManualReviewLayers,diagnosticLayerIds,DiagnosticLayerId,deletionApiPaths,deletionConfirmation,emptyDiagnosticState,emptyManualSelection,emptyRoad,excludeManualAtoms,gapReviewQueue,isAddableCandidate,initialLayerVisibility,LayerVisibility,ManualSelection,nextReviewGap,PreviewStage,previewStageAfterManualEdit,removeAt,resolveDeletableRoad,Road,SelectionBounds,selectedContinuityCheck,statutoryNetworkChoice,toggle,toggleLayerVisibility,toggleManualAtom,uniqueAdd}from'./model'
import ProjectEditor from'./ProjectEditor'
import BuilderMap from'./BuilderMap'
import{initialProjectVisibility,ProjectLayer}from'./projectModel'
import{PreviewProgress,PreviewProgressIndicator,previewDraftIsCurrent}from'./previewProgress'
import{applyRoadMapVisibility,removeLegacyRoadBuilderLayers,synchronizeRoadMapData}from'./roadMapLifecycle'
import{connectedPreviewState,finalReadyVisibility,reviewVisibility,startConnectSelected}from'./roadWorkflow'
import{MapClassificationField}from'./RoadFields'
import LocationEditor from'./LocationEditor'

type FC=GeoJSON.FeatureCollection
type DiagnosticLayers=Partial<Record<DiagnosticLayerId,FC>>
type AnalysisRow={class:string;nearbyFeatures:number;residualPassFeatures:number;matchedLengthMeters:number;medianResidualMeters:number|null;suggested:boolean}
type Meta={classes:{value:string,label:string}[];availableClasses:string[];missingClasses:string[];n13SourceFingerprint?:string}
type MatchPreviewResult={previewId:string;draftHash:string;reference:FC;referenceExcluded:FC;autoSelected:FC;autoSelectedSourceAtoms:FC;selectedSubstrings:FC;sourceAtoms:FC;sourceAdjacency:Record<string,string[]>;allCandidates:FC;residualRejected:FC;diagnostics:FC;ownership:FC}
type ConnectedPreviewResult={finalPreviewId:string;selected:FC;continuityChecks:FC;continuityGaps:FC;continuitySummary:ContinuitySummary;report:Record<string,unknown>;n13SourceFingerprint?:string}
type ManualHistoryEntry={selection:ManualSelection;regionCount:number;handledGapIds:Set<string>;ignoredGapIds:Set<string>}


const layerPaint:Record<DiagnosticLayerId,Record<string,unknown>>={
  allCandidates:{'line-color':'#8b6f47','line-width':1,'line-opacity':.18},
  residualRejected:{'line-color':'#777','line-width':1.5,'line-opacity':.25},
  autoSelectedSourceAtoms:{'line-color':'#9b1b1b','line-width':1.5,'line-opacity':.25},
  referenceExcluded:{'line-color':'#c65d16','line-width':4,'line-opacity':.7,'line-dasharray':[1,2]},
  reference:{'line-color':'#1677ff','line-width':3,'line-opacity':.85,'line-dasharray':[2,2]},
  ownership:{'circle-color':['match',['get','ownershipClass'],'1','#2e7d32','2','#f9a825','3','#8e24aa','#666'],'circle-radius':4,'circle-stroke-color':'white','circle-stroke-width':1},
  autoSelected:{'line-color':'#d92727','line-width':5,'line-opacity':.9},
  unselectedShortlist:{'line-color':'#da8a18','line-width':2.5,'line-opacity':.65},
  manuallyIncluded:{'line-color':'#00a7c4','line-width':5,'line-opacity':.95},
  manuallyExcluded:{'line-color':'#777','line-width':4,'line-opacity':.5,'line-dasharray':[2,2]},
  finalConnected:{'line-color':'#c2185b','line-width':6,'line-opacity':.9},
  continuityChecks:{'circle-color':'#75506f','circle-radius':4,'circle-opacity':.4},
  continuityGaps:{'circle-color':'#ff00c8','circle-radius':7,'circle-stroke-color':'#fff','circle-stroke-width':2},
  candidateHighlight:{'line-color':'#ff00c8','line-width':8,'line-opacity':.95},
}
const layerLabels:Record<DiagnosticLayerId,string>={reference:'OSM reference',ownership:'Ownership samples',autoSelected:'Auto selected',autoSelectedSourceAtoms:'Auto-selected source atoms',unselectedShortlist:'Available to include',manuallyExcluded:'Manually excluded',manuallyIncluded:'Manually included',finalConnected:'Final connected',continuityChecks:'Continuity checks',continuityGaps:'Continuity gaps',candidateHighlight:'Gap candidate',allCandidates:'All nearby N13',residualRejected:'Residual rejected',referenceExcluded:'OSM excluded members'}

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

function Map({layers,visibility,fitVersion,focusGeoJson,focusVersion,onFeature,excludeRegionMode,exclusionRegions,onExcludeRegion}:{layers:DiagnosticLayers;visibility:LayerVisibility;fitVersion:number;focusGeoJson?:FC;focusVersion:number;onFeature:(properties:object,layer:DiagnosticLayerId)=>void;excludeRegionMode:boolean;exclusionRegions:FC;onExcludeRegion:(bounds:SelectionBounds,rectangle:GeoJSON.Feature<GeoJSON.Polygon>)=>void}){
  const node=useRef<HTMLDivElement>(null)
  const map=useRef<MlMap|null>(null)
  const styleReady=useRef(false)
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
    const initialize=()=>{
      styleReady.current=true
      removeLegacyRoadBuilderLayers(instance)
      if(!instance.getSource('exclusion-regions')){
        instance.addSource('exclusion-regions',{type:'geojson',data:regionData()})
        instance.addLayer({id:'exclusion-regions-fill',type:'fill',source:'exclusion-regions',paint:{'fill-color':'#6c4cff','fill-opacity':.14}})
        instance.addLayer({id:'exclusion-regions-outline',type:'line',source:'exclusion-regions',paint:{'line-color':'#6c4cff','line-width':2,'line-dasharray':[2,1]}})
      }
      synchronizeRoadMapData(instance,layersRef.current,visibilityRef.current,layerPaint,
        (properties,id)=>onFeatureRef.current(properties,id))
      diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.moveLayer(id)})
    }
    instance.once('load',initialize)
    return()=>{styleReady.current=false;window.removeEventListener('keydown',onKeyDown);instance.remove();map.current=null}
  },[])

  useEffect(()=>{
    const instance=map.current;if(!instance)return
    const update=()=>{instance.getCanvas().style.cursor=excludeRegionMode?'crosshair':'';(instance.getSource('exclusion-regions')as GeoJSONSource|undefined)?.setData(exclusionRegions)}
    if(instance.loaded())update();else instance.once('load',update)
  },[excludeRegionMode,exclusionRegions])

  useEffect(()=>{
    const instance=map.current
    if(!instance||!styleReady.current)return
    removeLegacyRoadBuilderLayers(instance)
    synchronizeRoadMapData(instance,layers,visibilityRef.current,layerPaint,
      (properties,id)=>onFeatureRef.current(properties,id))
    diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.moveLayer(id)})
  },[layers])

  useEffect(()=>{
    const instance=map.current
    if(!instance||!styleReady.current)return
    applyRoadMapVisibility(instance,visibility)
  },[visibility])


  useEffect(()=>{
    if(!fitVersion)return
    const instance=map.current
    if(!instance)return
    const fit=()=>fitGeoJson(instance,layers.reference||layers.finalConnected||layers.autoSelected||layers.unselectedShortlist||layers.allCandidates)
    if(instance.loaded())fit();else instance.once('load',fit)
  },[fitVersion,layers])

  useEffect(()=>{
    if(!focusVersion||!focusGeoJson)return
    const instance=map.current;if(!instance)return
    const fit=()=>fitGeoJson(instance,focusGeoJson)
    if(instance.loaded())fit();else instance.once('load',fit)
  },[focusVersion,focusGeoJson])

  return <div ref={node} className="map"/>
}

function App(){
  const[mode,setMode]=useState<'roads'|'locations'|'projects'>('roads')
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
  const[focusVersion,setFocusVersion]=useState(0)
  const[continuityChecks,setContinuityChecks]=useState<ContinuityGap[]>([])
  const[continuityGaps,setContinuityGaps]=useState<ContinuityGap[]>([])
  const[continuitySummary,setContinuitySummary]=useState<ContinuitySummary>()
  const[ignoredGapIds,setIgnoredGapIds]=useState(new Set<string>())
  const[handledGapIds,setHandledGapIds]=useState(new Set<string>())
  const[selectedContinuityId,setSelectedContinuityId]=useState<string>()
  const[selectedCandidateIndex,setSelectedCandidateIndex]=useState(0)
  const[picked,setPicked]=useState<object>({})
  const[previewId,setPreviewId]=useState<string>()
  const[finalPreviewId,setFinalPreviewId]=useState<string>()
  const[previewStage,setPreviewStage]=useState<PreviewStage>('NO_MATCH')
  const[manualSelection,setManualSelection]=useState<ManualSelection>(emptyManualSelection())
  const[sourceAtoms,setSourceAtoms]=useState<FC>({type:'FeatureCollection',features:[]})
  const[sourceAdjacency,setSourceAdjacency]=useState<Record<string,string[]>>({})
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
    if(layer==='continuityGaps'||layer==='continuityChecks'){
      setSelectedContinuityId(String((properties as Record<string,unknown>).gapId||''));setSelectedCandidateIndex(0);return
    }
    if(!editSelection||!layer||!['autoSelected','unselectedShortlist','manuallyIncluded','manuallyExcluded'].includes(layer))return
    const atomId=String((properties as Record<string,unknown>).n13AtomId||'')
    if(!atomId)return
    setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length,handledGapIds:new Set(handledGapIds),ignoredGapIds:new Set(ignoredGapIds)}])
    setManualSelection(toggleManualAtom(manualSelection,atomId,Boolean((properties as Record<string,unknown>).automaticSelection)))
    setFinalPreviewId(undefined);setLayers(current=>({...current,finalConnected:{type:'FeatureCollection',features:[]}}));setPreviewStage(stage=>previewStageAfterManualEdit(stage))
  },[editSelection,exclusionRegions.features.length,manualSelection,handledGapIds,ignoredGapIds])
  const excludeRegion=useCallback((bounds:SelectionBounds,rectangle:GeoJSON.Feature<GeoJSON.Polygon>)=>{
    const shortlist={type:'FeatureCollection' as const,features:[...(layers.autoSelectedSourceAtoms?.features||[]),...(layers.unselectedShortlist?.features||[])]}
    const atomIds=atomIdsIntersectingBounds(shortlist,bounds)
    if(atomIds.length){
      setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length,handledGapIds:new Set(handledGapIds),ignoredGapIds:new Set(ignoredGapIds)}])
      setManualSelection(excludeManualAtoms(manualSelection,atomIds))
      setExclusionRegions(current=>({...current,features:[...current.features,rectangle]}))
      setFinalPreviewId(undefined);setLayers(current=>({...current,finalConnected:{type:'FeatureCollection',features:[]}}));setPreviewStage(stage=>previewStageAfterManualEdit(stage));setStatus(`Excluded ${atomIds.length} shortlisted N13 atom${atomIds.length===1?'':'s'} in region.`)
    }
    setExcludeRegionMode(false)
  },[layers.autoSelectedSourceAtoms,layers.unselectedShortlist,exclusionRegions.features.length,manualSelection,handledGapIds,ignoredGapIds])
  const reload=()=>Promise.all([api('/api/roads'),api('/api/metadata')]).then(([roadsResult,metadata])=>{setRoads(roadsResult.roads);setMeta(metadata)})
  useEffect(()=>{reload().catch(reason=>setError(reason.message))},[])
  const change=(patch:Partial<Road>)=>{setRoad(current=>({...current,...patch}));setPreviewIsCurrent(false);setPreviewStage('NO_MATCH');setPreviewId(undefined);setFinalPreviewId(undefined)}
  const clearGapReview=()=>{setContinuityChecks([]);setContinuityGaps([]);setContinuitySummary(undefined);setIgnoredGapIds(new Set());setHandledGapIds(new Set());setSelectedContinuityId(undefined);setSelectedCandidateIndex(0)}
  const clearDiagnostics=()=>{const cleared=emptyDiagnosticState();setLayers(cleared.layers);setAnalysis(cleared.analysis);setDiscovered(cleared.discovered);setPicked(cleared.picked);clearGapReview()}
  const invalidatePreview=()=>{setPreviewId(undefined);setFinalPreviewId(undefined);setPreviewDraftHash(undefined);setPreviewIsCurrent(false);setPreviewStage('NO_MATCH');setExclusionRegions({type:'FeatureCollection',features:[]});setExcludeRegionMode(false);clearGapReview()}
  const newRoad=()=>{setRoad(emptyRoad());setEditing(undefined);clearDiagnostics();invalidatePreview();setStatus('Ready');setError('')}
  const registeredRoad=resolveDeletableRoad(roads,road.id,editing)
  const act=async(label:string,path:string,body:unknown={road})=>{
    setStatus(label+'…');setError('')
    try{
      const result=await api(path,'POST',body)
      const hasGeometry=Boolean(result.reference||result.autoSelected||result.unselectedShortlist||result.allCandidates)
      setLayers(current=>({
        ...current,
        ...(result.reference?{reference:result.reference}:{}),
        ...(result.referenceExcluded?{referenceExcluded:result.referenceExcluded}:{}),
        ...(result.allCandidates?{allCandidates:result.allCandidates}:result.candidates?{allCandidates:result.candidates}:{}),
        ...(result.residualRejected?{residualRejected:result.residualRejected}:result.residualPass?{residualRejected:result.residualPass}:{}),
        ...(result.autoSelected?{autoSelected:result.autoSelected}:{}),
        ...(result.unselectedShortlist?{unselectedShortlist:result.unselectedShortlist}:{}),
        ...(result.ownership?{ownership:result.ownership}:{}),
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
    setSourceAtoms(result.sourceAtoms);setSourceAdjacency(result.sourceAdjacency)
    setLayers(current=>({...current,reference:result.reference,referenceExcluded:result.referenceExcluded,
      autoSelected:result.selectedSubstrings||result.autoSelected,autoSelectedSourceAtoms:result.autoSelectedSourceAtoms,unselectedShortlist:result.unselectedShortlist,allCandidates:result.allCandidates,residualRejected:result.residualRejected,ownership:result.ownership,manuallyIncluded:{type:'FeatureCollection',features:[]},manuallyExcluded:{type:'FeatureCollection',features:[]},finalConnected:{type:'FeatureCollection',features:[]}}))
    setFitVersion(version=>version+1)
  }
  const previewMatch=async()=>{
    const submitted=JSON.stringify(road)
    setError('');setStatus(layers.autoSelected?'Previewing new match…':'Previewing match…')
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
        clearGapReview()
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
      const started=await startConnectSelected(api,previewId,road,manualSelection) as {jobId:string}
      for(;;){
        await new Promise(resolve=>setTimeout(resolve,250))
        const job=await api(`/api/jobs/${started.jobId}`) as PreviewProgress&{result:ConnectedPreviewResult;error?:{message:string}}
        setPreviewProgress(job);if(job.status==='running')continue
        if(job.status==='failed')throw new Error(job.error?.message||'Connection failed')
        const completed=connectedPreviewState(job.result,manualSelection)
        const checks=job.result.continuityChecks.features.map(feature=>feature.properties as unknown as ContinuityGap)
        const gaps=job.result.continuityGaps.features.map(feature=>feature.properties as unknown as ContinuityGap)
        setLayers(current=>({...current,finalConnected:completed.finalConnected,continuityChecks:job.result.continuityChecks,continuityGaps:job.result.continuityGaps}));setFinalPreviewId(completed.finalPreviewId)
        setContinuityChecks(checks);setContinuityGaps(gaps);setContinuitySummary(job.result.continuitySummary);setIgnoredGapIds(new Set());setHandledGapIds(new Set());setSelectedContinuityId(gaps[0]?.gapId);setSelectedCandidateIndex(0)
        setVisibility(current=>finalReadyVisibility(current))
        setRoad(current=>({...current,manualSelection:completed.manualSelection,manualSelectionN13Fingerprint:job.result.n13SourceFingerprint}));setPreviewStage(completed.stage);setStatus('Connected preview ready ✓');return
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

  const reviewQueue=gapReviewQueue(continuityGaps,ignoredGapIds,handledGapIds)
  const selectedCheck=selectedContinuityCheck(continuityChecks,selectedContinuityId)||reviewQueue[0]
  const selectedIsUnresolved=Boolean(selectedCheck?.decision.startsWith('unresolved-'))
  const selectedHandled=Boolean(selectedCheck&&handledGapIds.has(selectedCheck.gapId))
  const selectedIgnored=Boolean(selectedCheck&&ignoredGapIds.has(selectedCheck.gapId))
  const selectedUnresolved=selectedIsUnresolved&&!selectedHandled&&!selectedIgnored?selectedCheck:undefined
  const inspectionStatus=selectedHandled?'Manually added during this review':selectedIgnored?'Ignored during this review':selectedIsUnresolved?'Needs review':'Auto resolved'
  const currentCandidate=selectedCheck?.candidatePaths[selectedCandidateIndex]
  const candidateHighlight=useMemo(()=>candidatePathGeoJson(sourceAtoms,currentCandidate),[sourceAtoms,currentCandidate]) as FC
  const focusGap=()=>{
    if(!selectedCheck)return
    const marker=[...(layers.continuityGaps?.features||[]),...(layers.continuityChecks?.features||[])].filter(feature=>feature.properties?.gapId===selectedCheck.gapId)
    const localIds=new Set([selectedCheck.upstreamN13AtomId,selectedCheck.downstreamN13AtomId,...(currentCandidate?.atomIds||[])])
    const local=sourceAtoms.features.filter(feature=>localIds.has(String(feature.properties?.n13AtomId||'')))
    setLayers(current=>({...current,candidateHighlight}));setFocusVersion(value=>value+1)
    setFocusGeoJson({type:'FeatureCollection',features:[...marker,...local]})
  }
  const[focusGeoJson,setFocusGeoJson]=useState<FC>()
  const addGapCandidate=(atomIds:string[])=>{
    if(!selectedCheck)return
    const edit=applyGapCandidateEdit(manualSelection,{atomIds},continuityGaps,selectedCheck.gapId,ignoredGapIds,handledGapIds)
    if(!edit)return
    setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length,handledGapIds:new Set(handledGapIds),ignoredGapIds:new Set(ignoredGapIds)}])
    setManualSelection(edit.manualSelection);setFinalPreviewId(edit.finalPreviewId)
    setHandledGapIds(edit.handledGapIds);setSelectedContinuityId(edit.nextGapId)
    setSelectedCandidateIndex(0);setPreviewStage(edit.stage)
    setStatus('Gap candidate added. Continue reviewing; run Connect Selected when finished.')
  }
  const ignoreGap=()=>{
    if(!selectedCheck)return
    const ignored=new Set([...ignoredGapIds,selectedCheck.gapId])
    setIgnoredGapIds(ignored);setSelectedContinuityId(nextReviewGap(continuityGaps,selectedCheck.gapId,ignored,handledGapIds)?.gapId)
    setSelectedCandidateIndex(0)
  }
  const displayedLayers=useMemo<DiagnosticLayers>(()=>{
    const displayed:DiagnosticLayers={...layers}
    if(layers.autoSelected&&layers.autoSelectedSourceAtoms){
      const review=deriveManualReviewLayers({autoSelected:layers.autoSelected,autoSelectedSourceAtoms:layers.autoSelectedSourceAtoms,sourceAtoms,sourceAdjacency},manualSelection)
      displayed.autoSelected={type:'FeatureCollection',features:review.autoSelected.features as GeoJSON.Feature[]}
      displayed.unselectedShortlist={type:'FeatureCollection',features:review.unselectedShortlist.features as GeoJSON.Feature[]}
      displayed.manuallyIncluded={type:'FeatureCollection',features:review.manuallyIncluded.features as GeoJSON.Feature[]}
      displayed.manuallyExcluded={type:'FeatureCollection',features:review.manuallyExcluded.features as GeoJSON.Feature[]}
    }
    displayed.candidateHighlight=candidateHighlight
    return displayed
  },[layers,manualSelection,sourceAtoms,sourceAdjacency,candidateHighlight])

  return <><nav className="modeTabs"><button className={mode==='roads'?'active':''} onClick={()=>setMode('roads')}>Roads</button><button className={mode==='locations'?'active':''} onClick={()=>setMode('locations')}>Locations</button><button className={mode==='projects'?'active':''} onClick={()=>setMode('projects')}>Projects</button></nav><main>{mode==='roads'?<><section className="editor"><header><h1>Road Builder</h1><b>LOCAL DEVELOPMENT TOOL ONLY</b></header><div className="toolbar"><button onClick={newRoad}>New road</button><select value={editing||''} onChange={async event=>{if(!event.target.value)return;const result=await api(`/api/roads/${event.target.value}`);setRoad(result.road);setEditing(event.target.value);clearDiagnostics();invalidatePreview()}}><option value="">Load existing road…</option>{roads.map(item=><option key={item.id} value={item.id}>{item.displayName} — {item.id}</option>)}</select>{registeredRoad&&<button className="destructive" onClick={deleteRoad}>Delete Road…</button>}</div><label>Canonical ID<input value={road.id} onChange={event=>change({id:event.target.value})}/>{registeredRoad&&<small className="registered-notice">Registered road</small>}</label><label>Display name<input value={road.displayName} onChange={event=>change({displayName:event.target.value})}/></label><fieldset><legend>Entity type</legend>{(['statutory-road','named-road']as const).map(type=><label className="inline" key={type}><input type="radio" checked={road.entityType===type} onChange={()=>change({entityType:type,reference:type==='named-road'?{type:'osm-name',names:[],tags:['name','name:ja','name:en','alt_name']}:{type:'osm-ref',ref:''}})}/>{type}</label>)}</fieldset><MapClassificationField value={road.presentationType} onChange={presentationType=>setRoad(current=>({...current,presentationType}))}/><label>Jurisdiction<input value={road.jurisdiction} onChange={event=>change({jurisdiction:event.target.value})}/></label><label>Aliases<List values={road.aliases} onChange={aliases=>change({aliases})}/></label>{road.entityType==='named-road'?<><label>OSM names<List values={road.reference.names||[]} onChange={names=>change({reference:{...road.reference,names}})}/></label><fieldset><legend>OSM exact-name tags</legend>{['name','name:ja','name:en','alt_name'].map(tag=><label className="inline" key={tag}><input type="checkbox" checked={(road.reference.tags||[]).includes(tag)} onChange={()=>change({reference:{...road.reference,tags:toggle(road.reference.tags||[],tag)}})}/>{tag}</label>)}</fieldset></>:<><label>OSM ref<input value={road.reference.ref||''} onChange={event=>change({reference:{...road.reference,ref:event.target.value}})}/></label><fieldset><legend>Road network</legend>{(['national','prefectural','custom'] as const).map(choice=><label className="inline" key={choice}><input type="radio" checked={statutoryNetworkChoice(road.reference.network)===choice} onChange={()=>change({reference:applyStatutoryNetworkChoice(road.reference,choice),roadClass:choice==='custom'?road.roadClass:choice})}/>{choice[0].toUpperCase()+choice.slice(1)}</label>)}</fieldset><label>OSM network<input placeholder="JP:national" value={road.reference.network||''} onChange={event=>change({reference:{...road.reference,network:event.target.value}})}/></label><label>Exclude segment names from reference (exact match)<List values={road.reference.excludeNames||[]} onChange={excludeNames=>change({reference:{...road.reference,excludeNames}})}/></label></>}<fieldset><legend>N13 candidate classifications</legend>{meta.classes.map(item=><label className="class" title={item.label} key={item.value}><input type="checkbox" checked={road.n13.classifications.includes(item.value)} onChange={()=>change({n13:{...road.n13,classifications:toggle(road.n13.classifications,item.value)}})}/>{item.value} — {item.label}{meta.missingClasses.includes(item.value)&&' (cache missing)'}</label>)}</fieldset><details><summary>Advanced matching settings</summary>{Object.entries(road.matching||{}).map(([key,value])=><label key={key}>{key}<input type="number" value={value} onChange={event=>change({matching:{...road.matching,[key]:Number(event.target.value)}})}/></label>)}{road.networkSelection&&Object.entries(road.networkSelection).map(([key,value])=><label key={key}>{key}<input type="number" value={value} onChange={event=>change({networkSelection:{...road.networkSelection,[key]:Number(event.target.value)}})}/></label>)}</details><div className="actions"><button onClick={()=>act('Inspecting OSM','/api/osm/inspect')}>Inspect OSM</button><button onClick={()=>act('Analyzing N13','/api/n13/analyze')}>Analyze N13</button><button disabled={previewProgress?.status==='running'} onClick={previewMatch}>{previewProgress?.status==='running'?'Previewing…':'Preview Match'}</button><button disabled={!canConnect(previewStage)||previewStage==='CONNECT_RUNNING'} onClick={connectSelected}>Connect Selected</button><button onClick={()=>save(false)}>{editing?'Save changes':'Save Road'}</button><button className="primary" disabled={!canBuild(previewStage,finalPreviewId)} onClick={()=>save(true)}>Save &amp; Build</button></div>{previewProgress&&<PreviewProgressIndicator value={previewProgress}/>}<p className={previewIsCurrent?'preview-current':'preview-stale'}>{previewStage==='FINAL_READY'?`Final connected preview current ✓ (${finalPreviewId?.slice(0,8)})`:previewIsCurrent?`Match preview ready ✓ (${previewDraftHash?.slice(0,8)}). Review selection, then run Connect Selected.`:'Preview out of date — run Preview Match again.'}</p><div className="selectionControls"><button className={editSelection?'active':''} disabled={!previewIsCurrent} onClick={()=>{setEditSelection(value=>{const next=!value;if(next&&previewStage==='FINAL_READY')setVisibility(current=>reviewVisibility(current));return next});setExcludeRegionMode(false)}}>Edit Selection</button><button className={excludeRegionMode?'active':''} disabled={!previewIsCurrent} onClick={()=>{setExcludeRegionMode(value=>!value);setEditSelection(false)}}>Exclude Region</button><button disabled={!manualHistory.length} onClick={()=>{const previous=manualHistory.at(-1);if(previous){setManualSelection(previous.selection);setHandledGapIds(new Set(previous.handledGapIds));setIgnoredGapIds(new Set(previous.ignoredGapIds));setSelectedContinuityId(undefined);setExclusionRegions(current=>({...current,features:current.features.slice(0,previous.regionCount)}));setManualHistory(history=>history.slice(0,-1));setFinalPreviewId(undefined);setLayers(current=>({...current,finalConnected:{type:'FeatureCollection',features:[]}}));setPreviewStage('MATCH_EDITED')}}}>Undo</button><button disabled={!manualSelection.include.length&&!manualSelection.exclude.length} onClick={()=>{setManualHistory(history=>[...history,{selection:manualSelection,regionCount:exclusionRegions.features.length,handledGapIds:new Set(handledGapIds),ignoredGapIds:new Set(ignoredGapIds)}]);setManualSelection(emptyManualSelection());setHandledGapIds(new Set());setSelectedContinuityId(undefined);setExclusionRegions({type:'FeatureCollection',features:[]});setFinalPreviewId(undefined);setLayers(current=>({...current,finalConnected:{type:'FeatureCollection',features:[]}}));setPreviewStage('MATCH_EDITED')}}>Clear manual edits</button>{editSelection&&<small>Click selected road to exclude. Click an available connected atom to include.</small>}{excludeRegionMode&&<small>Drag a rectangle over shortlisted N13 atoms to exclude them. Press Escape to cancel a drag.</small>}</div>{road.manualSelection&&(road.manualSelection.include.length>0||road.manualSelection.exclude.length>0)&&road.manualSelectionN13Fingerprint!==meta.n13SourceFingerprint&&<p className="error">Manual N13 edits are stale because the N13 source changed. Review them again. <button onClick={()=>setRoad(current=>({...current,manualSelection:emptyManualSelection(),manualSelectionN13Fingerprint:undefined}))}>Clear stale edits</button></p>}<p>Automatic selected: {layers.autoSelected?.features.length||0} · Manual inclusions: {manualSelection.include.length} · Manual exclusions: {manualSelection.exclude.length} · Exclusion regions: {exclusionRegions.features.length}</p>{continuitySummary&&<p><b>Continuity:</b> {continuitySummaryText(continuitySummary)}</p>}{continuitySummary&&<p><b>Review progress:</b> {handledGapIds.size+ignoredGapIds.size} / {continuitySummary.unresolvedCount} reviewed · {handledGapIds.size} added · {ignoredGapIds.size} ignored · {reviewQueue.length} remaining</p>}{continuitySummary&&continuitySummary.unresolvedCount>0&&!reviewQueue.length&&<p className="preview-current">Review complete — run Connect Selected to verify.</p>}{previewStage==='MATCH_EDITED'&&handledGapIds.size>0&&<p className="preview-stale">Manual gap edits pending — run Connect Selected when review is finished.</p>}{selectedCheck&&<section className="gapReview"><h3>{selectedIsUnresolved?'Continuity gap':'Continuity check'}</h3>{selectedUnresolved&&<p>Gap {reviewQueue.indexOf(selectedUnresolved)+1} / {reviewQueue.length}</p>}<p>Type: {selectedCheck.gapKind.replaceAll('-', ' ')}<br/>Physical gap: {selectedCheck.geometryGapMeters.toFixed(1)} m<br/>Reference gap: {selectedCheck.referenceGapMeters.toFixed(1)} m<br/>Decision: {selectedCheck.decision}<br/>Status: {inspectionStatus}</p>{selectedUnresolved&&<div className="gapNavigation"><button disabled={reviewQueue.indexOf(selectedUnresolved)<=0} onClick={()=>{setSelectedContinuityId(reviewQueue[reviewQueue.indexOf(selectedUnresolved)-1].gapId);setSelectedCandidateIndex(0)}}>Previous</button><button onClick={focusGap}>Zoom to gap</button><button disabled={reviewQueue.indexOf(selectedUnresolved)>=reviewQueue.length-1} onClick={()=>{setSelectedContinuityId(reviewQueue[reviewQueue.indexOf(selectedUnresolved)+1].gapId);setSelectedCandidateIndex(0)}}>Next</button></div>}{!selectedUnresolved&&<button onClick={focusGap}>{selectedIsUnresolved?'Zoom to gap':'Zoom to check'}</button>}{selectedCheck.candidatePaths.map((path,index)=><article className={index===selectedCandidateIndex?'candidate selected':'candidate'} key={path.atomIds.join('|')} onMouseEnter={()=>setSelectedCandidateIndex(index)} onClick={()=>setSelectedCandidateIndex(index)}><b>{selectedIsUnresolved?`Candidate path ${index+1}`:'Auto-selected path'}</b><p>N13 atoms: {path.atomIds.join(', ')}<br/>Class: {path.classes.join(', ')}<br/>Length: {path.lengthMeters.toFixed(1)} m · Progress: {path.progressRatio.toFixed(2)}</p>{selectedUnresolved&&(isAddableCandidate(path)?<button onClick={()=>addGapCandidate(path.atomIds)}>Add</button>:<small>No addable intermediate N13 atoms</small>)}</article>)}{selectedUnresolved&&<button onClick={ignoreGap}>Ignore gap</button>}</section>}<p className="status">{status}</p>{error&&<p className="error">{error}</p>}{discovered.length>0&&<section><h3>Detected OSM segment names</h3>{road.entityType==='named-road'?discovered.map(name=><label className="class" key={name}><input type="checkbox" checked={(road.reference.names||[]).includes(name)} onChange={()=>change({reference:{...road.reference,names:toggle(road.reference.names||[],name)}})}/>{name}</label>):<><p className="hint">Exclude segment names from reference (exact match)</p>{discovered.map(name=><label className="class" key={name}><input type="checkbox" checked={(road.reference.excludeNames||[]).includes(name)} onChange={()=>change({reference:{...road.reference,excludeNames:toggle(road.reference.excludeNames||[],name)}})}/>{name}</label>)}</>}</section>}{road.entityType==='statutory-road'&&(road.reference.excludeNames||[]).length>0&&<p className="identityWarning">This statutory reference is filtered and does not represent every current segment of the statutory route.</p>}<p>Available cached classes: {meta.availableClasses.join(' ')||'none'}<br/>Missing supported classes: {meta.missingClasses.join(' ')||'none'}</p>{meta.missingClasses.filter(item=>road.n13.classifications.includes(item)).map(item=><button key={item} onClick={async()=>{await act(`Preparing class ${item}`,'/api/n13/prepare',{class:item});reload()}}>Prepare class {item}</button>)}{analysis&&<table><thead><tr><th>Class</th><th>Nearby</th><th>Residual pass</th><th>Length</th><th>Median</th></tr></thead><tbody>{analysis.classes.map(item=><tr className={item.suggested?'suggested':''} key={item.class}><td>{item.class}</td><td>{item.nearbyFeatures}</td><td>{item.residualPassFeatures}</td><td>{(item.matchedLengthMeters/1000).toFixed(2)} km</td><td>{item.medianResidualMeters??'–'}</td></tr>)}</tbody></table>}</section><section className="mapPane"><div className="layers">{(['reference','ownership','autoSelected','unselectedShortlist','manuallyExcluded','manuallyIncluded','finalConnected','continuityGaps','continuityChecks','candidateHighlight','allCandidates','residualRejected','autoSelectedSourceAtoms','referenceExcluded']as DiagnosticLayerId[]).map(id=><label key={id}><input type="checkbox" checked={visibility[id]} onChange={()=>setVisibility(current=>toggleLayerVisibility(current,id))}/>{layerLabels[id]}</label>)}</div><Map layers={displayedLayers} visibility={visibility} fitVersion={fitVersion} focusGeoJson={focusGeoJson} focusVersion={focusVersion} onFeature={onFeature} excludeRegionMode={excludeRegionMode} exclusionRegions={exclusionRegions} onExcludeRegion={excludeRegion}/><pre>{JSON.stringify(picked,null,2)}</pre></section></>:mode==='locations'?<LocationEditor/>:<><ProjectEditor visibility={projectVisibility} onVisibility={setProjectVisibility} onPreview={value=>{setProjectLayers(value.layers);setProjectBounds(value.manifest.bounds);setPicked({})}} onClearPreview={()=>{setProjectLayers({});setProjectBounds(undefined);setPicked({})}}/><section className="mapPane"><BuilderMap layers={projectLayers} visibility={projectVisibility} bounds={projectBounds} onFeature={onFeature}/><pre>{JSON.stringify(picked,null,2)}</pre></section></>}</main></>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
