import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const STORY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function storySavePlugin(): Plugin {
  return {
    name: 'michi-story-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__michi/story/', (req, res, next) => {
        if (req.method !== 'PUT') return next()
        void (async () => {
          try {
            const id = decodeURIComponent((req.url ?? '').replace(/^\//, ''))
            if (!STORY_ID.test(id)) throw new Error('Invalid story ID')
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            const raw = Buffer.concat(chunks).toString('utf8')
            const story = JSON.parse(raw) as { id?: unknown; project?: unknown; steps?: unknown }
            if (story.id !== id) throw new Error('Story ID does not match request path')
            if (typeof story.project !== 'string' || !story.project.trim()) throw new Error('Story project must be non-empty')
            if (!Array.isArray(story.steps)) throw new Error('Story steps must be an array')

            const storiesDir = path.resolve(server.config.root, 'stories')
            const destination = path.join(storiesDir, `${id}.json`)
            const temporary = path.join(storiesDir, `.${id}.${process.pid}.${Date.now()}.tmp`)
            await mkdir(storiesDir, { recursive: true })
            await writeFile(temporary, `${JSON.stringify(story, null, 2)}\n`, 'utf8')
            await rename(temporary, destination)

            const payload = JSON.stringify({ story: { id, path: `stories/${id}.json` } })
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(payload)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: { message } }))
          }
        })()
      })
    },
  }
}

export default defineConfig({ plugins: [react(), storySavePlugin()], base: './' })
