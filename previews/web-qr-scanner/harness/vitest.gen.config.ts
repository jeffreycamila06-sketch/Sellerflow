// PREVIEW-ONLY: runs the one generator in this folder (never part of `npm test`, whose files are
// src/**/*.test.*). Makes the fake camera pictures for make-previews.cjs:
//   OUT=<folder> npx vitest run --config previews/web-qr-scanner/harness/vitest.gen.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["previews/web-qr-scanner/harness/camera-video.gen.ts"], testTimeout: 120000 },
});
