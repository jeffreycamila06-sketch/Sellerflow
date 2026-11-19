// MOCK-UP harness only (NOT the app build, nothing here ships). Serves the repo root; every
// "…/supabase" import resolves to the fake client, so the REAL Pickup Status screen runs unchanged.
// The options are drawn ON TOP of the real screen by harness.tsx (decorate) — no app file is edited.
//   npx vite --config docs/design/fm-pickup-options/harness/vite.config.mjs --port 5330
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
