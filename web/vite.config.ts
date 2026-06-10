import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite serves the SPA on :5173 and proxies API + websockets to Express on :4000.
// Prod: Express serves the built SPA from web/dist — single origin, no CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          if (/node_modules\/(react-markdown|remark-|mdast|micromark|unist|unified|vfile|hast)/.test(id)) return 'markdown'
        },
      },
    },
  },
})
