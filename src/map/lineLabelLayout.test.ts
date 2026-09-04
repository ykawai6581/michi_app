import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLineLabelLayoutController, LABEL_LAYOUT_DELAY_MS, POST_FOCUS_ZOOM_DURATION_MS, POST_FOCUS_ZOOM_OUT } from './lineLabelLayout'

describe('settled line-label layout lifecycle', () => {
  let frame: FrameRequestCallback | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    frame = undefined
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  function setup(layout: () => unknown = vi.fn()) {
    const events: string[] = []
    const map = {
      getZoom: vi.fn(() => 12), easeTo: vi.fn((value) => events.push(`ease:${JSON.stringify(value)}`)),
      getLayer: vi.fn(() => ({})), getSource: vi.fn(() => ({})),
      setPaintProperty: vi.fn((_layer, property, value) => events.push(`${property}:${JSON.stringify(value)}`)),
    }
    const controller = createLineLabelLayoutController(map, 'labels', 'source', () => { events.push('layout'); layout() })
    return { controller, map, events, layout }
  }

  it('waits for primary focus and the one-shot final zoom-out before layout', () => {
    const { controller, map, layout } = setup()
    controller.beginFocus()
    controller.onMoveEnd()
    expect(map.easeTo).toHaveBeenCalledWith({ zoom: 12 - POST_FOCUS_ZOOM_OUT, duration: POST_FOCUS_ZOOM_DURATION_MS })
    vi.advanceTimersByTime(LABEL_LAYOUT_DELAY_MS)
    expect(layout).not.toHaveBeenCalled()
    controller.onMoveEnd()
    vi.advanceTimersByTime(LABEL_LAYOUT_DELAY_MS)
    expect(layout).toHaveBeenCalledOnce()
    expect(map.easeTo).toHaveBeenCalledOnce()
  })

  it('manual moveend schedules without zooming and debounces a following zoomend', () => {
    const { controller, map, layout } = setup()
    controller.onMoveEnd(); controller.onZoomEnd()
    vi.advanceTimersByTime(LABEL_LAYOUT_DELAY_MS)
    expect(layout).toHaveBeenCalledOnce()
    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('cancels stale work and reads latest state in the delayed callback', () => {
    let selected = 'A'
    const values: string[] = []
    const { controller } = setup(() => values.push(selected))
    controller.schedule()
    selected = 'B'
    controller.schedule()
    vi.advanceTimersByTime(LABEL_LAYOUT_DELAY_MS)
    expect(values).toEqual(['B'])
  })

  it('hides before layout and fades in on the following animation frame', () => {
    const { controller, events } = setup()
    controller.schedule()
    vi.advanceTimersByTime(LABEL_LAYOUT_DELAY_MS)
    expect(events.slice(0, 2)).toEqual(['text-opacity-transition:{"duration":0,"delay":0}', 'text-opacity:0'])
    expect(events).toContain('layout')
    expect(events).not.toContain('text-opacity:1')
    frame?.(0)
    expect(events.at(-1)).toBe('text-opacity:1')
  })

  it('dispose prevents a pending layout from updating the map', () => {
    const { controller, layout } = setup()
    controller.schedule(); controller.dispose()
    vi.advanceTimersByTime(LABEL_LAYOUT_DELAY_MS)
    expect(layout).not.toHaveBeenCalled()
  })
})
