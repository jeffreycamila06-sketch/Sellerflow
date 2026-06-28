import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: false,
    // Multi-page build (3 entries):
    //  - index.html  -> redesign (src/redesign/main.tsx), served at "/"      (web + prod APK)
    //  - redesign.html -> redesign (same entry), served at "/redesign.html"  (test APK path —
    //    restored so the prod-pointed test APK that loads /redesign.html never 404s)
    //  - app.html    -> the previous App.tsx app, served at "/app.html"      (rollback escape hatch)
    rollupOptions: {
      input: {
        main: 'index.html',
        redesign: 'redesign.html',
        app: 'app.html',
      },
    },
  },
})
