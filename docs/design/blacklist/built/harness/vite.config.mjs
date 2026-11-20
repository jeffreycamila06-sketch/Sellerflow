// Picture harness only (NOT the app build, nothing here ships). Serves the repo root; every "…/supabase"
// import resolves to an empty client (no database), the QR reader answers what the page asks.
//   npx vite --config docs/design/blacklist/built/harness/vite.config.mjs --port 5334
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const fake = fileURLToPath(new URL("./noSupabase.ts", import.meta.url));
const qr = fileURLToPath(new URL("./fakeQr.ts", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL("../../../../../", import.meta.url)),
  plugins: [react()],
  resolve: { alias: [{ find: /^(\.\.\/)+supabase$/, replacement: fake }, { find: /^\.\.\/adapters\/qrDecode$/, replacement: qr }] },
  server: { strictPort: true },
});
