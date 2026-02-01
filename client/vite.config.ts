import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,
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
});
