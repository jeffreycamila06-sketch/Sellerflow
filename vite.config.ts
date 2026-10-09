import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { LOG_PURE_NAMES } from './src/lib/logPure'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: false,
    // Build 10: never ship source maps (scripts/check-dist.mjs fails CI if a .map or a
    // sourceMappingURL reaches dist).
    sourcemap: false,
    // Multi-page build (2 entries):
    //  - index.html  -> redesign (src/redesign/main.tsx), served at "/"      (web + prod APK)
    //  - redesign.html -> redesign (same entry), served at "/redesign.html"  (test APK path —
    //    restored so the prod-pointed test APK that loads /redesign.html never 404s)
    //  (app.html — the previous App.tsx app — is no longer built or served: Build 10. To restore the
    //   rollback escape hatch, add `app: 'app.html'` back to input below; the files are kept.)
    rollupOptions: {
      // src/lib/log.ts: logger calls are side-effect free in production → removed with their messages.
      treeshake: { manualPureFunctions: LOG_PURE_NAMES },
      input: {
        main: 'index.html',
        redesign: 'redesign.html',
      },
    },
  },
})
