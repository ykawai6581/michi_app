/* eslint-disable react-refresh/only-export-components */
import React,{useCallback,useEffect,useRef,useState} from 'react'
import{createRoot}from'react-dom/client'
import maplibregl,{GeoJSONSource,Map as MlMap}from'maplibre-gl'
import'maplibre-gl/dist/maplibre-gl.css'
import'./style.css'
import{applyStatutoryNetworkChoice,diagnosticLayerIds,DiagnosticLayerId,deletionApiPaths,deletionConfirmation,emptyDiagnosticState,emptyRoad,initialLayerVisibility,LayerVisibility,removeAt,resolveDeletableRoad,Road,statutoryNetworkChoice,toggle,toggleLayerVisibility,uniqueAdd}from'./model'
import ProjectEditor from'./ProjectEditor'
import BuilderMap from'./BuilderMap'
import{initialProjectVisibility,ProjectLayer}from'./projectModel'

type FC=GeoJSON.FeatureCollection
type DiagnosticLayers=Partial<Record<DiagnosticLayerId,FC>>
type AnalysisRow={class:string;nearbyFeatures:number;residualPassFeatures:number;matchedLengthMeters:number;medianResidualMeters:number|null;suggested:boolean}
type Meta={classes:{value:string,label:string}[];availableClasses:string[];missingClasses:string[]}

const layerPaint:Record<DiagnosticLayerId,Record<string,unknown>>={
  rejected:{'line-color':'#777','line-width':2,'line-opacity':.25},
  candidates:{'line-color':'#da8a18','line-width':3,'line-opacity':.55},
  referenceExcluded:{'line-color':'#c65d16','line-width':4,'line-opacity':.7,'line-dasharray':[1,2]},
  reference:{'line-color':'#1677ff','line-width':3,'line-opacity':.85,'line-dasharray':[2,2]},
  ownership:{'circle-color':['match',['get','ownershipClass'],'1','#2e7d32','2','#f9a825','3','#8e24aa','#666'],'circle-radius':4,'circle-stroke-color':'white','circle-stroke-width':1},
  selected:{'line-color':'#d92727','line-width':5,'line-opacity':.9},
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

function Map({layers,visibility,fitVersion,onFeature}:{layers:DiagnosticLayers;visibility:LayerVisibility;fitVersion:number;onFeature:(properties:object)=>void}){
  const node=useRef<HTMLDivElement>(null)
  const map=useRef<MlMap|null>(null)
  const layersRef=useRef(layers)
  const visibilityRef=useRef(visibility)
  const onFeatureRef=useRef(onFeature)
  layersRef.current=layers
  visibilityRef.current=visibility
  onFeatureRef.current=onFeature

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
    const synchronize=()=>{
      diagnosticLayerIds.forEach(id=>{
        const data=layersRef.current[id]
        if(!data)return
        const source=instance.getSource(id)as GeoJSONSource|undefined
        if(source)source.setData(data)
        else{
          instance.addSource(id,{type:'geojson',data})
          instance.addLayer({id,type:id==='ownership'?'circle':'line',source:id,layout:{visibility:visibilityRef.current[id]?'visible':'none'},paint:layerPaint[id]} as maplibregl.LayerSpecification)
          instance.on('click',id,event=>{if(event.features?.[0])onFeatureRef.current(event.features[0].properties||{})})
        }
      })
      diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.moveLayer(id)})
    }
    instance.once('load',synchronize)
    return()=>{instance.remove();map.current=null}
  },[])

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
        instance.on('click',id,event=>{if(event.features?.[0])onFeatureRef.current(event.features[0].properties||{})})
      }
    })
    const synchronizeInOrder=()=>{synchronize();diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.moveLayer(id)})}
    if(instance.loaded())synchronizeInOrder();else instance.once('load',synchronizeInOrder)
  },[layers,visibility])

  useEffect(()=>{
    const instance=map.current
    if(!instance)return
    const update=()=>diagnosticLayerIds.forEach(id=>{if(instance.getLayer(id))instance.setLayoutProperty(id,'visibility',layers[id]&&visibility[id]?'visible':'none')})
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
  const[previewDraftHash,setPreviewDraftHash]=useState<string>()
  const[previewIsCurrent,setPreviewIsCurrent]=useState(false)
  const onFeature=useCallback((properties:object)=>setPicked(properties),[])
  const reload=()=>Promise.all([api('/api/roads'),api('/api/metadata')]).then(([roadsResult,metadata])=>{setRoads(roadsResult.roads);setMeta(metadata)})
  useEffect(()=>{reload().catch(reason=>setError(reason.message))},[])
  const change=(patch:Partial<Road>)=>{setRoad(current=>({...current,...patch}));setPreviewIsCurrent(false)}
  const clearDiagnostics=()=>{const cleared=emptyDiagnosticState();setLayers(cleared.layers);setAnalysis(cleared.analysis);setDiscovered(cleared.discovered);setPicked(cleared.picked)}
  const invalidatePreview=()=>{setPreviewId(undefined);setPreviewDraftHash(undefined);setPreviewIsCurrent(false)}
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
        if(!previewId||!previewIsCurrent)throw new Error('Preview is stale; run Preview Match again.')
        await api(`/api/roads/${road.id}/build`,'POST',{previewId,road})
        setEditing(road.id);await reload();setStatus('Saved & built from current preview.')
      }else{
        await api(editing?`/api/roads/${editing}`:'/api/roads',editing?'PUT':'POST',{road})
        setEditing(road.id);await reload();setStatus('Road saved')
      }
    }catch(reason){setError((reason as Error).message);setStatus('Save failed')}
  }

  return <><nav className="modeTabs"><button className={mode==='roads'?'active':''} onClick={()=>setMode('roads')}>Roads</button><button className={mode==='projects'?'active':''} onClick={()=>setMode('projects')}>Projects</button></nav><main>{mode==='roads'?<><section className="editor"><header><h1>Road Builder</h1><b>LOCAL DEVELOPMENT TOOL ONLY</b></header><div className="toolbar"><button onClick={newRoad}>New road</button><select value={editing||''} onChange={async event=>{if(!event.target.value)return;const result=await api(`/api/roads/${event.target.value}`);setRoad(result.road);setEditing(event.target.value);clearDiagnostics();invalidatePreview()}}><option value="">Load existing road…</option>{roads.map(item=><option key={item.id} value={item.id}>{item.displayName} — {item.id}</option>)}</select>{registeredRoad&&<button className="destructive" onClick={deleteRoad}>Delete Road…</button>}</div><label>Canonical ID<input value={road.id} onChange={event=>change({id:event.target.value})}/>{registeredRoad&&<small className="registered-notice">Registered road</small>}</label><label>Display name<input value={road.displayName} onChange={event=>change({displayName:event.target.value})}/></label><fieldset><legend>Entity type</legend>{(['statutory-road','named-road']as const).map(type=><label className="inline" key={type}><input type="radio" checked={road.entityType===type} onChange={()=>change({entityType:type,reference:type==='named-road'?{type:'osm-name',names:[],tags:['name','name:ja','name:en','alt_name']}:{type:'osm-ref',ref:''}})}/>{type}</label>)}</fieldset><label>Jurisdiction<input value={road.jurisdiction} onChange={event=>change({jurisdiction:event.target.value})}/></label><label>Aliases<List values={road.aliases} onChange={aliases=>change({aliases})}/></label>{road.entityType==='named-road'?<><label>OSM names<List values={road.reference.names||[]} onChange={names=>change({reference:{...road.reference,names}})}/></label><fieldset><legend>OSM exact-name tags</legend>{['name','name:ja','name:en','alt_name'].map(tag=><label className="inline" key={tag}><input type="checkbox" checked={(road.reference.tags||[]).includes(tag)} onChange={()=>change({reference:{...road.reference,tags:toggle(road.reference.tags||[],tag)}})}/>{tag}</label>)}</fieldset></>:<><label>OSM ref<input value={road.reference.ref||''} onChange={event=>change({reference:{...road.reference,ref:event.target.value}})}/></label><fieldset><legend>Road network</legend>{(['national','prefectural','custom'] as const).map(choice=><label className="inline" key={choice}><input type="radio" checked={statutoryNetworkChoice(road.reference.network)===choice} onChange={()=>change({reference:applyStatutoryNetworkChoice(road.reference,choice),roadClass:choice==='custom'?road.roadClass:choice})}/>{choice[0].toUpperCase()+choice.slice(1)}</label>)}</fieldset><label>OSM network<input placeholder="JP:national" value={road.reference.network||''} onChange={event=>change({reference:{...road.reference,network:event.target.value}})}/></label><label>Exclude segment names from reference (exact match)<List values={road.reference.excludeNames||[]} onChange={excludeNames=>change({reference:{...road.reference,excludeNames}})}/></label></>}<fieldset><legend>N13 candidate classifications</legend>{meta.classes.map(item=><label className="class" title={item.label} key={item.value}><input type="checkbox" checked={road.n13.classifications.includes(item.value)} onChange={()=>change({n13:{...road.n13,classifications:toggle(road.n13.classifications,item.value)}})}/>{item.value} — {item.label}{meta.missingClasses.includes(item.value)&&' (cache missing)'}</label>)}</fieldset><details><summary>Advanced matching settings</summary>{Object.entries(road.matching||{}).map(([key,value])=><label key={key}>{key}<input type="number" value={value} onChange={event=>change({matching:{...road.matching,[key]:Number(event.target.value)}})}/></label>)}{road.networkSelection&&Object.entries(road.networkSelection).map(([key,value])=><label key={key}>{key}<input type="number" value={value} onChange={event=>change({networkSelection:{...road.networkSelection,[key]:Number(event.target.value)}})}/></label>)}</details><div className="actions"><button onClick={()=>act('Inspecting OSM','/api/osm/inspect')}>Inspect OSM</button><button onClick={()=>act('Analyzing N13','/api/n13/analyze')}>Analyze N13</button><button onClick={()=>act('Previewing match','/api/match/preview')}>Preview Match</button><button onClick={()=>save(false)}>{editing?'Save changes':'Save Road'}</button><button className="primary" disabled={!previewIsCurrent} onClick={()=>save(true)}>Save &amp; Build</button></div><p className={previewIsCurrent?'preview-current':'preview-stale'}>{previewIsCurrent?`Preview current ✓ (${previewDraftHash?.slice(0,8)})`:'Preview out of date — run Preview Match again.'}</p><p className="status">{status}</p>{error&&<p className="error">{error}</p>}{discovered.length>0&&<section><h3>Detected OSM segment names</h3>{road.entityType==='named-road'?discovered.map(name=><label className="class" key={name}><input type="checkbox" checked={(road.reference.names||[]).includes(name)} onChange={()=>change({reference:{...road.reference,names:toggle(road.reference.names||[],name)}})}/>{name}</label>):<><p className="hint">Exclude segment names from reference (exact match)</p>{discovered.map(name=><label className="class" key={name}><input type="checkbox" checked={(road.reference.excludeNames||[]).includes(name)} onChange={()=>change({reference:{...road.reference,excludeNames:toggle(road.reference.excludeNames||[],name)}})}/>{name}</label>)}</>}</section>}{road.entityType==='statutory-road'&&(road.reference.excludeNames||[]).length>0&&<p className="identityWarning">This statutory reference is filtered and does not represent every current segment of the statutory route.</p>}<p>Available cached classes: {meta.availableClasses.join(' ')||'none'}<br/>Missing supported classes: {meta.missingClasses.join(' ')||'none'}</p>{meta.missingClasses.filter(item=>road.n13.classifications.includes(item)).map(item=><button key={item} onClick={async()=>{await act(`Preparing class ${item}`,'/api/n13/prepare',{class:item});reload()}}>Prepare class {item}</button>)}{analysis&&<table><thead><tr><th>Class</th><th>Nearby</th><th>Residual pass</th><th>Length</th><th>Median</th></tr></thead><tbody>{analysis.classes.map(item=><tr className={item.suggested?'suggested':''} key={item.class}><td>{item.class}</td><td>{item.nearbyFeatures}</td><td>{item.residualPassFeatures}</td><td>{(item.matchedLengthMeters/1000).toFixed(2)} km</td><td>{item.medianResidualMeters??'–'}</td></tr>)}</tbody></table>}</section><section className="mapPane"><div className="layers">{(['reference','referenceExcluded','ownership','selected','candidates','rejected']as DiagnosticLayerId[]).map(id=><label key={id}><input type="checkbox" checked={visibility[id]} onChange={()=>setVisibility(current=>toggleLayerVisibility(current,id))}/>{id}</label>)}</div><Map layers={layers} visibility={visibility} fitVersion={fitVersion} onFeature={onFeature}/><pre>{JSON.stringify(picked,null,2)}</pre></section></>:<><ProjectEditor visibility={projectVisibility} onVisibility={setProjectVisibility} onPreview={value=>{setProjectLayers(value.layers);setProjectBounds(value.manifest.bounds);setPicked({})}} onClearPreview={()=>{setProjectLayers({});setProjectBounds(undefined);setPicked({})}}/><section className="mapPane"><BuilderMap layers={projectLayers} visibility={projectVisibility} bounds={projectBounds} onFeature={onFeature}/><pre>{JSON.stringify(picked,null,2)}</pre></section></>}</main></>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
