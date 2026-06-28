import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: false,
    // Multi-page build. As of the redesign switch, index.html IS the redesign
    // (src/redesign/main.tsx -> RedesignApp) and is served at "/". The previous
    // production app (src/main.tsx -> App.tsx) is parked at app.html, emitted at
    // /app.html as an untouched escape hatch / rollback target.
    rollupOptions: {
      input: {
        main: 'index.html',
        app: 'app.html',
      },
    },
  },
})
