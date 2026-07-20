import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  server: {
    // Honour PORT so parallel dev servers can coexist; 5173 stays the default
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,
        changeOrigin: true,
      },
      '/events': 'http://localhost:3334',
      '/sessions': 'http://localhost:3334',
      '/health': 'http://localhost:3334',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
