// PREVIEW-ONLY Vite config (screenshots for docs/design/*): the real app with every import of
// src/supabase.ts aliased to the in-memory fake (src/dev/fakeSupabase.ts). Never used by
// `npm run build` / `npm run dev`.  Run:  npx vite --config vite.preview.config.ts --port 5199
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^(\.\.?\/)+supabase$/, replacement: fileURLToPath(new URL("./src/dev/fakeSupabase.ts", import.meta.url)) }],
  },
  server: { port: 5199, strictPort: true },
});
