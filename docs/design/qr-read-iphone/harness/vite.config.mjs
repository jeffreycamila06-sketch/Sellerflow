// Picture harness only (NOT the app build, nothing here ships). The Blacklist page of
// docs/design/blacklist/built/harness with the REAL QR reader (no fake): a real photo goes in, the
// app's own reader (and its WebAssembly) reads it. No database (every "…/supabase" import is empty).
//   npx vite --config docs/design/qr-read-iphone/harness/vite.config.mjs --port 5335
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const fake = fileURLToPath(new URL("../../blacklist/built/harness/noSupabase.ts", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  plugins: [react()],
  resolve: { alias: [{ find: /^(\.\.\/)+supabase$/, replacement: fake }] },
  server: { strictPort: true },
});
