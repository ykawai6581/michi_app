import { describe, expect, it } from 'vitest'
import { ffmpegArguments, frameCount, frameTimestamp, outputPaths, parseArguments } from './render-story-core.mjs'

describe('Story renderer logic', () => {
  it('calculates frame counts from the authoritative duration', () => {
    expect(frameCount(10, 30)).toBe(300)
    expect(frameCount(10.1, 30)).toBe(303)
    expect(frameCount(0, 30)).toBe(1)
  })
  it('calculates every timestamp from its absolute frame number', () => {
    expect(frameTimestamp(0, 30)).toBe(0)
    expect(frameTimestamp(1, 30)).toBe(1 / 30)
    expect(frameTimestamp(30, 30)).toBe(1)
  })
  it('validates required and numeric CLI options', () => {
    expect(() => parseArguments([])).toThrow('Missing required option')
    expect(() => parseArguments(['--story', 'demo', '--fps', '0'])).toThrow('--fps')
    expect(() => parseArguments(['--story', 'demo', '--width', '1.5'])).toThrow('--width')
    expect(() => parseArguments(['--story', 'demo', '--width', '1000', '--height', '700'])).toThrow('16:9')
  })
  it('prevents Story IDs from escaping the generated output root', () => {
    expect(() => outputPaths('/repo', '../../foo')).toThrow('Invalid Story ID')
    expect(outputPaths('/repo', 'safe-story').framesDirectory).toBe('/repo/renders/safe-story/frames')
  })
  it('builds FFmpeg arguments with the requested FPS and numbered PNG pattern', () => {
    const args = ffmpegArguments(24)
    expect(args).toContain('24')
    expect(args).toContain('frame_%06d.png')
    expect(args).toContain('yuv420p')
  })
})
