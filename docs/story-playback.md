# Story playback (Phase 1)

A **Project** contains the map data and assets available to a presentation. A
**Story** is a separate JSON document under `stories/` that describes what app
state changes, and when. Story code calls the same state operations as the UI;
it does not click controls or manipulate MapLibre layers.

## Schema and actions

```json
{
  "id": "shinjuku-demo",
  "displayName": "新宿 demo",
  "project": "shinjuku",
  "steps": [
    { "action": "setBasemap", "value": "presentation" },
    { "action": "setOverlay", "layer": "modernRoads", "visible": true },
    { "action": "show", "id": "jp-national-20" },
    { "action": "activate", "id": "jp-national-20", "cameraDuration": 1.5 },
    { "action": "wait", "duration": 3 }
  ]
}
```

Every step may have an optional `label`. Supported steps are:

- `show` / `hide`: add or remove one entity from the selected scene. This is
  distinct from an overlay and does not change narrative focus.
- `activate` / `deactivate`: set or clear narrative focus. Activation delegates
  camera behavior to the app. `cameraDuration`, when present, is in seconds.
- `setBasemap`: one of `presentation`, `rekichizu`, `gsi`, `white`, or
  `transparent`. Asynchronous Rekichizu setup is awaited.
- `setOverlay`: sets one existing “重ねる情報” key (`modernRoads`, `railways`,
  `stations`, `historicalRoads`, `historicalPosts`, or `jurisdictions`). It
  never changes individually selected entities.
- `setDarkMode`: `auto` or `manual`; `setDarkBasemap` changes the existing
  manual dark-overlay value. Auto mode retains its normal effective-dark rules.
- `selectJurisdiction`: selects an existing feature by its canonical
  `jurisdictionId`; `clearJurisdiction` clears only that selection.
- `wait`: cancellable wall-clock pacing in seconds. Story duration is the sum
  of waits, not camera durations.

Entity IDs are exact `feature.properties.id` values in the loaded project. No
display-name or fuzzy resolution is performed. Unknown entity and jurisdiction
IDs stop playback with a clear error.

## Loading and controls

Open `?project=shinjuku&story=shinjuku-demo`. If `project` is omitted, the
story's project is used; a mismatch is an error. Story mode starts paused and
shows a compact controller with Play, Pause, Restart, Previous, and Next.

Add `autoplay=1` to play after project, map, layers, and icons are ready. Add
`capture=1` for the unchanged 16:9 scene without sidebar, controls, or chrome;
capture implies autoplay.

For development and future capture automation, `window.__michiStory` exposes
`play`, `pause`, `restart`, `next`, `previous`, and `getState`. The browser also
dispatches `michi:story-ready`, `michi:story-complete`, and
`michi:story-error`. Phase 1 deliberately has no seek, arbitrary camera, audio,
or deterministic frame-rendering commands.
