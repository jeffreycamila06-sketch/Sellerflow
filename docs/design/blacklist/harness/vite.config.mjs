// Picture harness only (NOT the app build, nothing here ships). Serves the repo root; every
// "…/supabase" import resolves to an empty client, so nothing can reach a real database.
//   npx vite --config docs/design/blacklist/harness/vite.config.mjs --port 5333
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const fake = fileURLToPath(new URL("./noSupabase.ts", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  plugins: [react()],
  resolve: { alias: [{ find: /^(\.\.\/)+supabase$/, replacement: fake }] },
  server: { strictPort: true },
});
