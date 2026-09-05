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
capture implies autoplay for backward compatibility. Use `capture=1&autoplay=0`
when an external caller controls time, or add `t=12.4` to open at one frame.

For development and future capture automation, `window.__michiStory` exposes
`play`, `pause`, `restart`, `next`, `previous`, `seek`, `waitForRender`,
`getDuration`, `getTime`, and `getState`. The browser also dispatches
`michi:story-ready`, `michi:story-complete`, and `michi:story-error`.

## Deterministic timeline and seeking

Playback has three separate layers: ordered authored JSON is compiled into an
immutable millisecond timeline, the timeline is evaluated at an absolute Story
time, and that frame is applied through React and MapLibre. Evaluation neither
replays earlier actions nor starts browser camera animations. Play and external
seeking use the same timeline clock and explicit easing functions.

```js
await window.__michiStory.seek(12.4)
await window.__michiStory.waitForRender()

window.__michiStory.getDuration() // seconds
window.__michiStory.getTime()     // seconds
```

`seek()` clamps negative and out-of-range values and applies the evaluated
camera with `jumpTo`. `waitForRender()` is a bounded barrier for React/source
updates, asynchronous basemaps, and a subsequent MapLibre frame. Repeated seeks
to one timestamp are independent of previous seek order.

Total duration now includes `wait`, `setView.duration`, and
`activate.cameraDuration`. Activation changes narrative focus at the start and
its camera transition consumes Story time; the fixed 1.25-second line reveal
runs concurrently. This intentionally replaces the earlier Phase-1 behavior in
which activation camera movement was only a wall-clock side effect.

## Explicit camera composition (`setView`)

Story actions deliberately keep visibility, narrative focus, and composition separate:

- `show` changes visibility only and never moves the camera.
- `activate` establishes narrative focus (including title, reveal, active styling, and the app-defined focus behavior).
- `setView` changes only the authored camera composition; it does not change the active or visible features.

A view step stores `[longitude, latitude]`, zoom, and optional bearing, pitch, duration (seconds), and label. Its authored transition is evaluated deterministically; Previous, Restart, and **Preview from here** seek to authored boundaries using the same engine.

```json
{
  "action": "setView",
  "center": [139.7007, 35.6903],
  "zoom": 15.2,
  "bearing": 0,
  "pitch": 0,
  "duration": 1.2,
  "label": "追分と両街道が見える構図"
}
```

For example, `activate location:shinjuku-oiwake`, then `setView` to a slightly wider composition, then `show` the 甲州街道 and 青梅街道. 新宿追分 remains active and the later visibility actions do not steal its focus or camera composition.

## Story authoring pane

Opening a Story displays its editable ordered steps above the regular sidebar controls. Click a row to select it as the insertion point; **Current View** captures the actual MapLibre center, zoom, bearing, and pitch, while **Wait** adds a two-second hold. New steps are inserted after the selection (or appended when nothing is selected).

Drag a row by its handle to reorder it. The compact duplicate and delete actions operate only on that Story step. View fields and wait duration are editable in the details area beneath the list. **Preview selected** executes one logical action through the player; **Preview from here** uses the same baseline reconstruction path as Previous, then continues playback normally.

**Download Story JSON** validates and downloads the current in-memory Story as `<story.id>.json`. Editing never mutates an imported JSON module or writes to `stories/` automatically. The authoring pane is entirely hidden in `capture=1` mode.
