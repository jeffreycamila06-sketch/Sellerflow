// Screenshot harness only (NOT the app build). Serves the repo root; every "…/supabase" import
// resolves to the fake client below, so the REAL Pickup Status screen + adapters run unchanged.
//   npx vite --config docs/design/pickup-check-flow/harness/vite.config.mjs --port 5310
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
