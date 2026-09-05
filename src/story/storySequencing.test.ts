import { describe, expect, it } from 'vitest'
import type { ProjectData } from '../data/project'
import type { EntityFeature, LayerVisibility } from '../types/geo'
import { StoryPlayer } from './storyPlayer'
import type { StoryAppOperations, StoryAppSnapshot } from './storyTypes'

const feature = (id: string): EntityFeature => ({
  type: 'Feature',
  properties: { id, name: id, type: 'place' },
  geometry: { type: 'Point', coordinates: [139.7, 35.7] },
})

const layers: LayerVisibility = {
  basemap: 'presentation',
  darkBasemap: false,
  modernRoads: false,
  railways: false,
  stations: false,
  historicalRoads: false,
  historicalPosts: false,
  jurisdictions: false,
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function operations(calls: string[], showGate?: Promise<void>, activateGate?: Promise<void>): StoryAppOperations {
  const snapshot: StoryAppSnapshot = { selected: [], activeFeature: null, basemap: 'presentation', layers, darkMode: 'auto', jurisdiction: null, camera: { center: [139, 35], zoom: 10, bearing: 0, pitch: 0 } }
  return {
    snapshot: () => snapshot,
    restore: async () => { calls.push('restore') },
    showFeature: async (value) => { calls.push(`show:${value.properties.id}:start`); await showGate; calls.push(`show:${value.properties.id}:committed`) },
    hideFeature: async (value) => { calls.push(`hide:${value.properties.id}`) },
    activateFeature: async (value) => { calls.push(`activate:${value.properties.id}:start`); await activateGate; calls.push(`activate:${value.properties.id}:committed`) },
    deactivateFeature: async () => { calls.push('deactivate') },
    setBasemap: async () => {},
    setOverlayVisibility: async () => {},
    setDarkMode: async () => {},
    setManualDarkBasemap: async () => {},
    selectJurisdiction: async () => {},
    clearJurisdiction: async () => {},
    getCurrentView: () => snapshot.camera,
    setView: async (view) => { snapshot.camera = view },
  }
}

describe('story sequencing barriers', () => {
  it('does not activate until the preceding show has committed', async () => {
    const item = feature('location:test')
    const gate = deferred()
    const calls: string[] = []
    const player = new StoryPlayer(
      { id: 'sequence', project: 'test', steps: [{ action: 'show', id: item.properties.id }, { action: 'activate', id: item.properties.id }] },
      { searchable: [item] } as ProjectData,
      operations(calls, gate.promise),
    )

    const playback = player.play()
    await Promise.resolve()
    expect(calls).toEqual(['show:location:test:start'])

    gate.resolve()
    await playback
    expect(calls).toEqual([
      'show:location:test:start',
      'show:location:test:committed',
      'activate:location:test:start',
      'activate:location:test:committed',
    ])
  })

  it('does not run a following state action until activation has committed', async () => {
    const first = feature('road:first')
    const second = feature('historical-post:second')
    const gate = deferred()
    const calls: string[] = []
    const player = new StoryPlayer(
      { id: 'sequence', project: 'test', steps: [{ action: 'activate', id: first.properties.id }, { action: 'show', id: second.properties.id }] },
      { searchable: [first, second] } as ProjectData,
      operations(calls, undefined, gate.promise),
    )

    const playback = player.play()
    await Promise.resolve()
    expect(calls).toEqual(['activate:road:first:start'])

    gate.resolve()
    await playback
    expect(calls).toEqual([
      'activate:road:first:start',
      'activate:road:first:committed',
      'show:historical-post:second:start',
      'show:historical-post:second:committed',
    ])
  })
})
