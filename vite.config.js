import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 4173, strictPort: false },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
