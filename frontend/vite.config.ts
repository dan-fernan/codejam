import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // y-monaco (last published against monaco-editor's pre-"exports"-map layout)
      // hardcodes this full legacy path, which monaco-editor's current exports
      // map can't resolve. Point it straight at the real file instead.
      'monaco-editor/esm/vs/editor/editor.api.js': path.resolve(
        __dirname,
        'node_modules/monaco-editor/esm/vs/editor/editor.api.js'
      ),
    },
  },
  server: {
    proxy: {
      // REST -> Spring. /api/rooms/recent -> http://localhost:8080/rooms/recent
      '/api': {
        target: 'http://localhost:8080',
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      // WebSockets -> Node. ws://localhost:5173/ws/<roomId> -> ws://localhost:1234/<roomId>
      '/ws': {
        target: 'ws://localhost:1234',
        ws: true,                                   // forward WS upgrade, not just plain HTTP
        rewrite: (path) => path.replace(/^\/ws/, '')
      }
    }
  }
})
