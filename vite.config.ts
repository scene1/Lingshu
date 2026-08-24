import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.LINGSHU_BACKEND_URL || process.env.OPENCLAW_BACKEND_URL || 'http://localhost:3005'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // 关闭模块预加载，避免首屏加载不需要的重型 chunk（如编辑器 620KB）
    modulePreload: false,
    rollupOptions: {
      output: {
        // 自动按 node_modules 包名分包
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor-react'
            }
            if (id.includes('antd') || id.includes('@ant-design')) {
              return 'vendor-antd'
            }
            if (id.includes('@uiw') || id.includes('@codemirror')) {
              return 'vendor-editor'
            }
          }
        }
      }
    }
  }
})
