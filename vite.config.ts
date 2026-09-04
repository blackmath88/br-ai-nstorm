import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The dev server proxies `/api` and `/mcp` to the backend, so the browser makes
 * same-origin requests and there is no CORS story to get wrong in development.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.BRAINSTORM_API ?? 'http://localhost:8787', changeOrigin: true },
      '/mcp': { target: process.env.BRAINSTORM_API ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
})
