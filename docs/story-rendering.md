# Rendering a Story to video

MICHI's renderer captures the fixed 16:9 map scene as a deterministic PNG sequence and then asks the system FFmpeg to assemble an MP4. It does not record browser playback.

## One-time setup

Install the Chromium binary used by Playwright once after installing the repository dependencies:

```bash
npx playwright install chromium
```

FFmpeg must also be available on `PATH`. It is a system prerequisite and is not bundled with MICHI. Project bundles under `public/projects/<project>/` must already be materialized; the renderer intentionally does not rebuild them.

## Render

```bash
npm run render-story -- \
  --story shinjuku-koshu-oiwake-demo \
  --fps 30 \
  --width 1920 \
  --height 1080
```

The defaults are 30 FPS, 1920 × 1080, and local Vite port 4173. Only 16:9 output is supported. The command starts and stops Vite automatically. To reuse an existing app server, pass `--base-url http://127.0.0.1:5173`. Pass `--frames-only` to skip MP4 assembly.

Each run clears only `renders/<story-id>/frames/`, then keeps every generated frame alongside `video.mp4`. Generated files are ignored by Git.

## Deterministic pipeline

```text
Story
→ compiled timeline
→ seek(frame/fps)
→ waitForRender()
→ PNG
→ FFmpeg
→ MP4
```

The app's compiled timeline supplies the duration. Every timestamp is calculated independently as the absolute frame number divided by FPS; preview playback rate and browser execution speed are never used. Basemap crossfade progress, the geometric Japanese cloud wipe used to mask Story basemap changes, and post-camera vector-label opacity are all evaluated from that absolute Story timestamp. `setBasemap` does not lengthen the Story: its incoming viewport sources are preloaded at zero alpha, then `waitForRender()` synchronizes React, the required basemap sources, and a subsequent MapLibre paint before the screenshot.

The cloud transition is generated as SVG geometry from fixed seeds rather than loaded from a bitmap. The two independently generated cloud banks slide inward from opposite sides, fully overlap near the middle of the transition, and then recede. The actual basemap blend is concentrated around this covered interval so tile/style changes remain hidden. Because both cloud position and basemap blend are Story-time values, slow network or capture performance changes wall-clock rendering time but not the resulting frame sequence.

This resource wait is bounded and scoped to the incoming basemap rather than all
project sources. A slow renderer may therefore spend extra wall-clock time on a
frame without changing its captured transition progress. Presentation and
Rekichizu symbol layers hide during camera motion; MICHI annotations remain
visible. GSI labels cannot be independently hidden because the text is part of
the raster tile image, although the entire GSI basemap still transitions.

Consequently, render wall-clock duration is unrelated to video duration. A 30-second Story may take several minutes to render while frame 283 at 30 FPS always represents Story time `283 / 30`.
