import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.LINGSHU_BACKEND_URL || process.env.OPENCLAW_BACKEND_URL || 'http://localhost:3005'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
