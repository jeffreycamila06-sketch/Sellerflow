import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: false,
    // Multi-page build. The production app (index.html -> src/main.tsx -> App.tsx)
    // is UNCHANGED. redesign.html is a SEPARATE entry for the Phase 2+ redesign
    // preview, emitted at /redesign.html. Adding this input does not alter the
    // index.html bundle or how production renders.
    rollupOptions: {
      input: {
        main: 'index.html',
        redesign: 'redesign.html',
      },
    },
  },
})
