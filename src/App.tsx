import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CameraPanel } from './components/CameraPanel'
import { ActiveFeatureOverlay } from './components/ActiveFeatureOverlay'
import { DataPanel } from './components/DataPanel'
import { LayerPanel } from './components/LayerPanel'
import { MapView, type FeatureFocusRequest, type MapHandle } from './components/MapView'
import { SearchPanel } from './components/SearchPanel'
import { StylePanel } from './components/StylePanel'
import { exportPNG } from './export/exportPNG'
import { loadProject, resolveProjectId, type ProjectData } from './data/project'
import type { DarkModeBehavior, EntityFeature, HighlightStyle, LayerVisibility, PointOverlayStyle, RoadSourceVisibility, SceneItem } from './types/geo'
import { initialLayerVisibility, initialPointOverlayStyle } from './map/overlayState'
import { DEFAULT_HIGHLIGHT_STYLE } from './map/highlightDefaults'
import { usePresentationScale } from './map/presentationScale'
import { effectiveDarkBasemap } from './map/darkBasemap'
import { JurisdictionPanel } from './components/JurisdictionPanel'
import { clearTemporarySceneItems, removeTemporarySceneItem, seedProjectRoads } from './scene/items'
import { jurisdictionSnapshotDate, loadJurisdictionManifest, loadJurisdictionSnapshot, normalizeJurisdictionConfig, reconcileJurisdictionSelection, selectedJurisdictions, type JurisdictionCollection, type JurisdictionFeature, type JurisdictionLayerConfig, type JurisdictionManifest } from './data/jurisdictions'
import { loadStory, parseStoryQuery, resolveStoryProject } from './story/storyLoader'
import type { Story, StoryAppOperations, StoryAppSnapshot } from './story/storyTypes'
import { useStoryPlayer } from './story/useStoryPlayer'
import { StoryControls } from './story/StoryControls'

const roadSources: RoadSourceVisibility = { n13: true, osm: false }

export default function App() {
  const mapRef = useRef<MapHandle>(null)
  const { ref: mapStageRef, sceneSize, presentationScale, visualScale, renderPixelRatio } = usePresentationScale<HTMLDivElement>()
  const query = useMemo(() => parseStoryQuery(window.location.search), [])
  const [story, setStory] = useState<Story | null>(null)
  const [storyLoadError, setStoryLoadError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectData | null>(null)
  const [sceneItems, setSceneItems] = useState<SceneItem[]>([])
  const [activeFeature, setActiveFeature] = useState<EntityFeature | null>(null)
  const [focusRequest, setFocusRequest] = useState<FeatureFocusRequest | null>(null)
  const focusSequence = useRef(0)
  const [selectionMode, setSelectionMode] = useState<'multi' | 'single'>('multi')
  const [dataLoading, setDataLoading] = useState(true)
  const [dataLoadError, setDataLoadError] = useState(false)
  const [ready, setReady] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [style, setStyle] = useState<HighlightStyle>({ ...DEFAULT_HIGHLIGHT_STYLE })
  const [layers, setLayers] = useState<LayerVisibility>(initialLayerVisibility)
  const [darkModeBehavior, setDarkModeBehavior] = useState<DarkModeBehavior>('auto')
  const [pointStyle, setPointStyle] = useState<PointOverlayStyle>(initialPointOverlayStyle)
  const [jurisdiction, setJurisdiction] = useState<JurisdictionLayerConfig>(normalizeJurisdictionConfig())
  const [jurisdictionManifest, setJurisdictionManifest] = useState<JurisdictionManifest | null>(null)
  const [jurisdictionData, setJurisdictionData] = useState<JurisdictionCollection | null>(null)
  const [jurisdictionLoading, setJurisdictionLoading] = useState(false)
  const [jurisdictionError, setJurisdictionError] = useState<string | null>(null)
  const [storyCommitTick, setStoryCommitTick] = useState(0)
  const storyCommitWaiters = useRef(new Set<() => void>())

  const current = useRef({ sceneItems, activeFeature, layers, darkModeBehavior, jurisdiction, jurisdictionData })
  current.current = { sceneItems, activeFeature, layers, darkModeBehavior, jurisdiction, jurisdictionData }

  const waitForAppCommit = useCallback(() => new Promise<void>((resolve) => {
    storyCommitWaiters.current.add(resolve)
    setStoryCommitTick((value) => value + 1)
  }), [])
  useEffect(() => {
    if (!storyCommitWaiters.current.size) return
    const waiters = [...storyCommitWaiters.current]
    storyCommitWaiters.current.clear()
    waiters.forEach((resolve) => resolve())
  }, [storyCommitTick])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const loadedStory = query.storyId ? await loadStory(query.storyId) : null
        const projectId = loadedStory ? resolveStoryProject(query, loadedStory) : resolveProjectId()
        const value = await loadProject(projectId)
        if (!active) return
        setStory(loadedStory); setSceneItems((items) => seedProjectRoads(value.searchable, items)); setActiveFeature(null); setProject(value)
        const config = normalizeJurisdictionConfig(value.config.jurisdictionLayer); setJurisdiction(config); setLayers((value) => ({ ...value, jurisdictions: config.enabled }))
      } catch (error) {
        if (!active) return
        if (query.storyId) setStoryLoadError(error instanceof Error ? error.message : String(error))
        else setDataLoadError(true)
      } finally { if (active) setDataLoading(false) }
    })()
    return () => { active = false }
  }, [query])

  useEffect(() => { let active = true; loadJurisdictionManifest().then((value) => { if (!active) return; setJurisdictionManifest(value); setJurisdiction((current) => { const prefecture = value.providers[current.provider]?.prefectures[current.prefecture]; return { ...current, snapshotDate: jurisdictionSnapshotDate(prefecture, current.resolution, current.snapshotDate) } }) }).catch((error) => active && setJurisdictionError(`Jurisdiction manifest unavailable: ${String(error)}`)); return () => { active = false } }, [])
  useEffect(() => { if (!jurisdiction.enabled || !jurisdictionManifest) return; if (!jurisdiction.snapshotDate) { setJurisdictionData(null); return } let active = true; setJurisdictionLoading(true); setJurisdictionError(null); const config = { ...normalizeJurisdictionConfig(), enabled: true, provider: jurisdiction.provider, prefecture: jurisdiction.prefecture, resolution: jurisdiction.resolution, snapshotDate: jurisdiction.snapshotDate, displayMode: jurisdiction.displayMode }; loadJurisdictionSnapshot(jurisdictionManifest, config).then((collection) => { if (!active) return; setJurisdictionData(collection); setJurisdiction((current) => ({ ...current, selection: reconcileJurisdictionSelection(collection, current.selection) })) }).catch((error) => active && setJurisdictionError(`Snapshot ${jurisdiction.snapshotDate} failed: ${String(error)}`)).finally(() => active && setJurisdictionLoading(false)); return () => { active = false } }, [jurisdiction.enabled, jurisdiction.provider, jurisdiction.prefecture, jurisdiction.resolution, jurisdiction.snapshotDate, jurisdiction.displayMode, jurisdictionManifest])

  const changeJurisdiction = useCallback((value: JurisdictionLayerConfig) => { setJurisdiction(value); setLayers((current) => ({ ...current, jurisdictions: value.enabled })) }, [])
  const onReady = useCallback(() => setReady(true), [])
  const showFeature = useCallback((feature: EntityFeature) => setSceneItems((items) => { const existing = items.find((item) => item.feature.properties.id === feature.properties.id); return existing ? items.map((item) => item === existing ? { ...item, visible: true } : item) : [...items, { feature, visible: true }] }), [])
  const hideFeature = useCallback((feature: EntityFeature) => { setSceneItems((items) => items.map((item) => item.feature.properties.id === feature.properties.id ? { ...item, visible: false } : item)); setActiveFeature((active) => active?.properties.id === feature.properties.id ? null : active) }, [])
  const activateFeature = useCallback((feature: EntityFeature, options?: FeatureFocusRequest['options']) => { setActiveFeature(feature); setFocusRequest({ sequence: ++focusSequence.current, feature, options }) }, [])
  const toggleFeature = useCallback((feature: EntityFeature) => { const existing = current.current.sceneItems.find((item) => item.feature.properties.id === feature.properties.id); const selecting = !existing?.visible; if (selecting) { showFeature(feature); activateFeature(feature) } else hideFeature(feature) }, [activateFeature, hideFeature, showFeature])
  const selectFeature = useCallback((feature: EntityFeature) => { if (selectionMode === 'multi') { toggleFeature(feature); return } showFeature(feature); activateFeature(feature) }, [activateFeature, selectionMode, showFeature, toggleFeature])
  const selectJurisdictionFeature = useCallback((feature: JurisdictionFeature, animateCamera = true) => { setJurisdiction((current) => ({ ...current, selection: { level: feature.properties.jurisdictionLevel === 'parent' ? 'parent' : 'municipality', value: feature.properties.municipalityName } })); setActiveFeature({ type: 'Feature', properties: { id: feature.properties.jurisdictionId, name: feature.properties.municipalityName, type: 'jurisdiction', period: feature.properties.snapshotDate, note: feature.properties.derived ? `Historical parent municipality · Derived from ${feature.properties.memberCount} ward polygons · ${feature.properties.prefectureName}` : [feature.properties.parentJurisdictionName, feature.properties.prefectureName].filter(Boolean).join(' · ') }, geometry: feature.geometry }); if (!animateCamera) setFocusRequest(null) }, [])
  const deleteFeature = (id: string) => { setSceneItems((items) => removeTemporarySceneItem(items, id)); setActiveFeature((feature) => feature?.properties.id === id ? null : feature) }

  const operations = useMemo<StoryAppOperations>(() => ({
    snapshot: () => { const state = current.current; return { selected: state.sceneItems.filter((item) => item.visible).map((item) => item.feature), activeFeature: state.activeFeature, basemap: state.layers.basemap, layers: { ...state.layers }, darkMode: state.darkModeBehavior, jurisdiction: state.jurisdiction.selection } },
    restore: async (snapshot: StoryAppSnapshot) => { const ids = new Set(snapshot.selected.map((feature) => feature.properties.id)); setSceneItems((items) => { const byId = new Map(items.map((item) => [item.feature.properties.id, item])); snapshot.selected.forEach((feature) => { if (!byId.has(feature.properties.id)) byId.set(feature.properties.id, { feature, visible: true }) }); return [...byId.values()].map((item) => ({ ...item, visible: ids.has(item.feature.properties.id) })) }); setActiveFeature(snapshot.activeFeature); setLayers({ ...snapshot.layers }); setDarkModeBehavior(snapshot.darkMode); setJurisdiction((value) => ({ ...value, selection: snapshot.jurisdiction })); await waitForAppCommit() },
    showFeature: async (feature) => { showFeature(feature); await waitForAppCommit() },
    hideFeature: async (feature) => { hideFeature(feature); await waitForAppCommit() },
    activateFeature: async (feature, options) => { activateFeature(feature, options); await waitForAppCommit() },
    deactivateFeature: async () => { setActiveFeature(null); setFocusRequest(null); await waitForAppCommit() },
    setBasemap: async (value) => { setLayers((layers) => ({ ...layers, basemap: value })); await waitForAppCommit(); await mapRef.current?.waitForBasemap(value) },
    setOverlayVisibility: async (layer, visible) => { setLayers((layers) => ({ ...layers, [layer]: visible })); if (layer === 'jurisdictions') setJurisdiction((value) => ({ ...value, enabled: visible })); await waitForAppCommit() },
    setDarkMode: async (value) => { setDarkModeBehavior(value); await waitForAppCommit() },
    setManualDarkBasemap: async (value) => { setLayers((layers) => ({ ...layers, darkBasemap: value })); await waitForAppCommit() },
    selectJurisdiction: async (id, options) => { const feature = current.current.jurisdictionData?.features.find((feature) => feature.properties.jurisdictionId === id); if (!feature) throw new Error(`Story jurisdiction not found: ${id}`); selectJurisdictionFeature(feature, options?.animateCamera !== false); await waitForAppCommit() },
    clearJurisdiction: async () => { setJurisdiction((value) => ({ ...value, selection: null })); await waitForAppCommit() },
  }), [activateFeature, hideFeature, selectJurisdictionFeature, showFeature, waitForAppCommit])
  const { player, state: storyState } = useStoryPlayer(story, project, operations, ready && !jurisdictionLoading, query.autoplay)

  const visibleFeatures = useMemo(() => sceneItems.filter((item) => item.visible).map((item) => item.feature), [sceneItems])
  const jurisdictionHighlight = useMemo(() => jurisdictionData ? selectedJurisdictions(jurisdictionData, jurisdiction.selection) : [], [jurisdictionData, jurisdiction.selection])
  const darkBasemap = effectiveDarkBasemap(darkModeBehavior, layers.darkBasemap, activeFeature !== null)
  if (storyLoadError) return <main className="app-load-error" role="alert">{storyLoadError}</main>
  return <main className={`app ${query.capture ? 'capture-mode' : ''}`}>
    <header><div className="brand-mark">道</div><div className="brand"><strong>MICHI MAP</strong><span>Historical scene editor</span></div><div className="header-context"><span>PROJECT</span><b>{project?.config.displayName ?? '読み込み中…'}</b></div><button className="mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)}>編集パネル</button><button className="export" disabled={!ready} onClick={() => { const map = mapRef.current?.getMap(); if (map) exportPNG(map) }}><span>↓</span> PNGを書き出す</button></header>
    <div className="workspace"><div ref={mapStageRef} className={`map-stage ${darkBasemap ? 'dark-map' : ''}`}><div className="scene-frame" style={{ width: sceneSize.width, height: sceneSize.height, transform: `scale(${visualScale})`, '--map-scale': presentationScale } as CSSProperties}><MapView ref={mapRef} project={project} selected={visibleFeatures} activeFeature={activeFeature} focusRequest={focusRequest} selectionMode={selectionMode} jurisdictionData={jurisdictionData} jurisdictionHighlight={jurisdictionHighlight} jurisdictionSelection={jurisdiction.selection} highlightStyle={style} presentationScale={presentationScale} sceneSize={sceneSize} renderPixelRatio={renderPixelRatio} visibility={layers} darkBasemap={darkBasemap} revealAreaEnabled={darkModeBehavior === 'auto'} pointStyle={pointStyle} roadSources={roadSources} onSelectFeature={selectFeature} onSelectJurisdiction={selectJurisdictionFeature} onReady={onReady} /><ActiveFeatureOverlay feature={activeFeature} highlightStyle={style} /></div></div>
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>{story && player && <StoryControls story={story} player={player} state={storyState} />}<SearchPanel entities={project?.searchable ?? []} loading={dataLoading} loadError={dataLoadError} items={sceneItems} selectionMode={selectionMode} onSelectionMode={setSelectionMode} onSelect={selectFeature} onToggle={toggleFeature} onDelete={deleteFeature} onClear={() => { setSceneItems(clearTemporarySceneItems); setActiveFeature(null) }} /><LayerPanel value={layers} onChange={setLayers} darkModeBehavior={darkModeBehavior} onDarkModeBehaviorChange={setDarkModeBehavior} pointStyle={pointStyle} onPointStyleChange={setPointStyle} /><JurisdictionPanel manifest={jurisdictionManifest} collection={jurisdictionData} value={jurisdiction} loading={jurisdictionLoading} error={jurisdictionError} onChange={changeJurisdiction} /><StylePanel value={style} onChange={setStyle} /><CameraPanel getMap={() => mapRef.current?.getMap() ?? null} /><DataPanel /><footer>地図: {layers.basemap === 'rekichizu' ? 'れきちず / Rekichizu (CC BY-NC-ND 4.0)' : 'OpenFreeMap / OSM'} · Project bundle: {project?.config.id ?? '…'} <span>v0.3-alpha</span></footer></aside>
    </div>
  </main>
}
