// Picture harness only (NOT the app build, nothing here ships). Serves the repo root; every
// "…/supabase" import resolves to the fake client, so the REAL Pickup Status screen runs unchanged.
//   npx vite --config docs/design/fm-pickup-accuracy-2/harness/vite.config.mjs --port 5331
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const fake = fileURLToPath(new URL("./fakeSupabase.ts", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  plugins: [react()],
  resolve: { alias: [{ find: /^(\.\.\/)+supabase$/, replacement: fake }] },
  server: { strictPort: true },
});
