import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const bufferEntry = fileURLToPath(new URL('./node_modules/buffer/index.js', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { buffer: bufferEntry },
  },
  optimizeDeps: { include: ['buffer'] },
  define: { global: 'globalThis' },
  server: {
    port: 5173,
    // The backend serves the mission API under /api and /health, /ready at
    // the root: forward them as they are, without rewriting the path.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
      '/ready': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
