// Test harness for the one-sticker engine: installs the Sans outlines + CJK cell atlases
// synchronously, and a fallback drawer on @napi-rs/canvas (the same Skia text engine as Chrome /
// Android WebView) with the bundled fonts in server/fonts (+ optional extra proof fonts from
// SFL_PROOF_FONTS, e.g. Noto Sans KR / Arabic for the pictures in docs/design/one-sticker).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { installSansFace, setFallbackRunDrawer, canvasRunDrawer, type CjkCell, type SansWeight } from "../oneStickerFonts";
import { SANS_FACE as F400 } from "../sansOutlines.400";
import { SANS_FACE as F700 } from "../sansOutlines.700";
import { SANS_FACE as F900 } from "../sansOutlines.900";
import { SANS_FACE as FX } from "../sansOutlines.cjkx";
import type { Fonts } from "../oneStickerText";
import type { GlyphAtlas } from "../stickerRaster";

const req = createRequire(import.meta.url);
type NapiCanvas = { createCanvas(w: number, h: number): { width: number; height: number; getContext(k: "2d"): unknown; toBuffer(m: string): Buffer }; GlobalFonts: { registerFromPath(p: string, alias?: string): unknown } };
let napi: NapiCanvas | null = null;
export function napiCanvas(): NapiCanvas | null {
  if (napi) return napi;
  try { napi = req("@napi-rs/canvas") as NapiCanvas; } catch { napi = null; }
  return napi;
}
let fontsRegistered = false;
function registerFonts(n: NapiCanvas): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const root = path.resolve(__dirname, "../../../../server/fonts");
  const reg = (p: string, alias: string) => { try { if (fs.existsSync(p)) n.GlobalFonts.registerFromPath(p, alias); } catch { /* ignore */ } };
  reg(path.join(root, "NotoSansThai.ttf"), "Noto Sans Thai");
  reg(path.join(root, "NotoSans.ttf"), "Noto Sans");
  reg("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "Noto Sans JP");
  const extra = process.env.SFL_PROOF_FONTS;
  if (extra && fs.existsSync(extra)) {
    for (const f of fs.readdirSync(extra)) {
      if (/kr-korean/.test(f)) reg(path.join(extra, f), "Noto Sans KR");
      else if (/arabic/.test(f)) reg(path.join(extra, f), "Noto Sans Arabic");
    }
  }
}
export function installNodeFallbackDrawer(): boolean {
  const n = napiCanvas();
  if (!n) { setFallbackRunDrawer(null); return false; }
  registerFonts(n);
  setFallbackRunDrawer(canvasRunDrawer((w, h) => n.createCanvas(w, h) as never));
  return true;
}

const cjkCache: Partial<Record<CjkCell, GlyphAtlas>> = {};
export async function cjkCell(cell: CjkCell): Promise<GlyphAtlas> {
  if (cjkCache[cell]) return cjkCache[cell]!;
  const m = cell === 18 ? await import("../glyphAtlas.cjkReg18") : cell === 20 ? await import("../glyphAtlas.cjkReg20") : cell === 24 ? await import("../glyphAtlas.cjkReg24") : await import("../glyphAtlas.cjkReg32");
  cjkCache[cell] = m.CJK_REG_ATLAS;
  return m.CJK_REG_ATLAS;
}
export function installSans(): void {
  installSansFace(400, F400); installSansFace(700, F700); installSansFace(900, F900); installSansFace("cjkx", FX);
}
export async function fullFonts(): Promise<Fonts> {
  installSans();
  const sans: Partial<Record<SansWeight, typeof F400>> = { 400: F400, 700: F700, 900: F900 };
  return { sans, cjkx: FX, cjk: { 18: await cjkCell(18), 20: await cjkCell(20), 24: await cjkCell(24), 32: await cjkCell(32) } };
}

/** A 1-bit raster → PNG (white paper, black ink), optionally scaled up for viewing. */
export function rasterPng(r: { w: number; h: number; rowBytes: number; buf: Uint8Array }, scale = 1, border = true): Buffer | null {
  const n = napiCanvas();
  if (!n) return null;
  const pad = border ? 2 : 0;
  const cv = n.createCanvas(r.w * scale + pad * 2, r.h * scale + pad * 2);
  const ctx = cv.getContext("2d") as { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
  ctx.fillStyle = "#9aa3b2"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(pad, pad, r.w * scale, r.h * scale);
  ctx.fillStyle = "#111111";
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) ctx.fillRect(pad + x * scale, pad + y * scale, scale, scale);
  return cv.toBuffer("image/png");
}
