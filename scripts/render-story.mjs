#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ffmpegArguments, frameCount, frameTimestamp, outputPaths, parseArguments } from './render-story-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let serverProcess
let browser
let stopping = false

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  const signal = name => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name) } catch { child.kill(name) } }
  signal('SIGTERM')
  if (await Promise.race([exited.then(() => true), delay(3_000).then(() => false)])) return
  signal('SIGKILL')
  await exited
}

async function cleanup() {
  if (stopping) return
  stopping = true
  await browser?.close().catch(() => {})
  await stopChild(serverProcess)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143) })

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`Vite exited before becoming ready (exit code ${child.exitCode})`)
    try { const response = await fetch(url); if (response.ok) return } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error(`MICHI server did not become reachable at ${url} within 30 seconds${lastError ? `: ${lastError.message}` : ''}`)
}

function runFfmpeg(framesDirectory, fps, videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ffmpegArguments(fps, videoPath), { cwd: framesDirectory, stdio: 'inherit' })
    child.once('error', error => reject(Object.assign(error, { ffmpegLaunch: true })))
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}`)))
  })
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const paths = outputPaths(root, options.story)
  const baseUrl = options.baseUrl ?? `http://127.0.0.1:${options.port}/`
  if (!options.baseUrl) {
    serverProcess = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(options.port), '--strictPort'], { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    serverProcess.stdout.on('data', chunk => process.stderr.write(`[vite] ${chunk}`))
    serverProcess.stderr.on('data', chunk => process.stderr.write(`[vite] ${chunk}`))
  }
  await waitForServer(baseUrl, serverProcess)

  let chromium
  try { ({ chromium } = await import('playwright')) } catch (error) {
    throw new Error(`Playwright is unavailable (${error.message}). Run npm install for this checkout, then run: npx playwright install chromium`)
  }
  browser = await chromium.launch({ headless: true,  channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: options.width, height: options.height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') { const text = message.text(); consoleErrors.push(text); console.error(`[browser] ${text}`) } })
  page.on('pageerror', error => { consoleErrors.push(error.message); console.error(`[browser] ${error.message}`) })

  const captureUrl = new URL(baseUrl)
  captureUrl.searchParams.set('story', options.story)
  captureUrl.searchParams.set('capture', '1')
  captureUrl.searchParams.set('autoplay', '0')
  await page.goto(captureUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => Boolean(window.__michiStory || document.querySelector('.app-load-error')), undefined, { timeout: 30_000 }).catch(error => {
    throw new Error(`Story API did not become ready within 30 seconds${consoleErrors.length ? `: ${consoleErrors.at(-1)}` : ` (${error.message})`}`)
  })
  const appError = await page.evaluate(() => document.querySelector('.app-load-error')?.textContent ?? null)
  if (appError) throw new Error(`${appError}\nBuild/materialize the Story's public/projects/<project>/ bundle first if it is unavailable.`)
  await page.evaluate(() => document.fonts.ready)

  const scene = page.locator('.scene-frame')
  const box = await scene.boundingBox()
  if (!box) throw new Error('The capture scene (.scene-frame) is not visible')
  if (Math.abs(box.width - options.width) > 0.5 || Math.abs(box.height - options.height) > 0.5) throw new Error(`Capture scene is ${box.width}x${box.height}, expected ${options.width}x${options.height}`)
  const duration = await page.evaluate(() => window.__michiStory.getDuration())
  const frames = frameCount(duration, options.fps)
  await rm(paths.framesDirectory, { recursive: true, force: true })
  await mkdir(paths.framesDirectory, { recursive: true })
  console.log(`Story: ${options.story}\nDuration: ${duration.toFixed(3)} s\nResolution: ${options.width} × ${options.height}\nFPS: ${options.fps}\nFrames: ${frames}\n`)
  const interval = Math.max(1, Math.round(options.fps))
  for (let frame = 0; frame < frames; frame += 1) {
    const timestamp = frameTimestamp(frame, options.fps)
    try {
      await page.evaluate(async t => { await window.__michiStory.seek(t); await window.__michiStory.waitForRender() }, timestamp)
    } catch (error) { throw new Error(`Story render failed at frame ${frame} (t=${timestamp.toFixed(3)} s): ${error.message}`) }
    await scene.screenshot({ path: path.join(paths.framesDirectory, `frame_${String(frame).padStart(6, '0')}.png`), type: 'png' })
    if (frame === 0 || (frame + 1) % interval === 0 || frame + 1 === frames) console.log(`[${frame + 1}/${frames}] t=${timestamp.toFixed(3)} s`)
  }
  console.log(`\nRendered frames:\n${path.relative(root, paths.framesDirectory)}/`)
  if (!options.framesOnly) {
    try { await runFfmpeg(paths.framesDirectory, options.fps, paths.videoPath) } catch (error) {
      if (error.ffmpegLaunch && error.code === 'ENOENT') throw new Error(`FFmpeg was not found on PATH.\n\nFrames were rendered successfully to:\n${path.relative(root, paths.framesDirectory)}/\n\nInstall FFmpeg and rerun the renderer.`)
      throw new Error(`FFmpeg assembly failed. PNG frames have been kept at ${path.relative(root, paths.framesDirectory)}/: ${error.message}`)
    }
    console.log(`\nVideo:\n${path.relative(root, paths.videoPath)}`)
  }
}

main().catch(error => { console.error(`\nRender failed: ${error.message}`); process.exitCode = 1 }).finally(cleanup)
