// BITMAP-ONLY golden fixtures (multi-language coverage: Vietnamese diacritics,
// Indonesian, mixed CJK+Latin). Deliberately NOT added to the shared
// mobile/ios/tspl-parity/manifest.json — that manifest drives the frozen TEXT
// golden matrix (tspl.test.ts + the Mac/JVM run.sh + the iOS XCTest gate), and
// adding entries there would demand Mac-regenerated .bin goldens. These extras
// exist only for the bitmap raster/SDK-stream golden suites.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RasterPayload } from "../stickerRaster";

export interface ExtraBitmapFixture { key: string; payload: RasterPayload; w: number; h: number }

const FIXTURES_DIR = join(process.cwd(), "src/redesign/adapters/__tests__/fixtures");
const load = (name: string): RasterPayload => JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8"));

export function extraBitmapFixtures(): ExtraBitmapFixture[] {
  return [
    { key: "x_vietnamese_ext_100x60", payload: load("vietnamese_ext"), w: 100, h: 60 },
    { key: "x_vietnamese_ext_60x40", payload: load("vietnamese_ext"), w: 60, h: 40 },
    { key: "x_indonesian_100x60", payload: load("indonesian"), w: 100, h: 60 },
    { key: "x_mixed_cjk_latin_100x60", payload: load("mixed_cjk_latin"), w: 100, h: 60 },
  ];
}
