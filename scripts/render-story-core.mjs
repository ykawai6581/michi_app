import path from 'node:path'

export const DEFAULT_RENDER_OPTIONS = Object.freeze({ fps: 30, width: 1920, height: 1080, port: 4173 })

export function frameCount(durationSeconds, fps) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) throw new Error('Story duration must be a finite, non-negative number')
  return Math.max(1, Math.ceil(durationSeconds * fps))
}

export const frameTimestamp = (frameNumber, fps) => frameNumber / fps

export function validateStoryId(value) {
  if (!value) throw new Error('Missing required option: --story <story-id>')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid Story ID. Use only letters, numbers, underscores, and hyphens.')
  return value
}

function readValue(args, index, option) {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

export function parseArguments(args) {
  const options = { ...DEFAULT_RENDER_OPTIONS, framesOnly: false }
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (option === '--frames-only') { options.framesOnly = true; continue }
    if (!['--story', '--fps', '--width', '--height', '--port', '--base-url'].includes(option)) throw new Error(`Unknown option: ${option}`)
    const value = readValue(args, index, option); index += 1
    if (option === '--story') options.story = value
    else if (option === '--base-url') options.baseUrl = value
    else options[option.slice(2)] = Number(value)
  }
  options.story = validateStoryId(options.story)
  if (!Number.isFinite(options.fps) || options.fps <= 0) throw new Error('--fps must be a number greater than 0')
  for (const dimension of ['width', 'height']) {
    if (!Number.isInteger(options[dimension]) || options[dimension] <= 0) throw new Error(`--${dimension} must be a positive integer`)
  }
  if (options.width * 9 !== options.height * 16) throw new Error(`Unsupported resolution ${options.width}x${options.height}: width and height must have a 16:9 aspect ratio`)
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 to 65535')
  if (options.baseUrl) {
    try { options.baseUrl = new URL(options.baseUrl).toString() } catch { throw new Error('--base-url must be a valid HTTP(S) URL') }
    if (!/^https?:/.test(options.baseUrl)) throw new Error('--base-url must be a valid HTTP(S) URL')
  }
  return options
}

export function outputPaths(root, storyId) {
  const safeId = validateStoryId(storyId)
  const storyDirectory = path.resolve(root, 'renders', safeId)
  return { storyDirectory, framesDirectory: path.join(storyDirectory, 'frames'), videoPath: path.join(storyDirectory, 'video.mp4') }
}

export function ffmpegArguments(fps, videoPath = '../video.mp4') {
  return ['-y', '-framerate', String(fps), '-start_number', '0', '-i', 'frame_%06d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath]
}
