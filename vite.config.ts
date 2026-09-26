import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works from any static host path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  // Most of the bundle is the official data tables.
  build: { chunkSizeWarningLimit: 800 },
})
