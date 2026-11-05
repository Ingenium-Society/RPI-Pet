import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Pi on the USB link by default. For local development without a Pi:
//   PI_URL=http://127.0.0.1:3000 npm dev   (and: cargo run -p pi-service)
const PI_URL = process.env.PI_URL ?? 'http://192.168.7.1:3000'

// Interaction log lives on the laptop only: <repo>/logs/interactions.jsonl (git-ignored).
// The app POSTs one JSON object per interaction to /__log (dev server only).
function interactionLogger(): Plugin {
  const dir = fileURLToPath(new URL('../../logs', import.meta.url))
  return {
    name: 'interaction-logger',
    configureServer(server) {
      server.middlewares.use('/__log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const line = JSON.stringify(JSON.parse(body))
            mkdirSync(dir, { recursive: true })
            appendFileSync(join(dir, 'interactions.jsonl'), line + '\n')
            res.statusCode = 204
          } catch {
            res.statusCode = 400
          }
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), interactionLogger()],
  server: {
    proxy: { '/v1': { target: PI_URL, changeOrigin: true } },
  },
  preview: {
    proxy: { '/v1': { target: PI_URL, changeOrigin: true } },
  },
})
