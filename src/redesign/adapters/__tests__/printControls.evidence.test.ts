// RENDERED EVIDENCE (Nov 3) — the printer-auditor agent's pictures. Skipped unless PRINTER_FIX_OUT is set:
//   PRINTER_FIX_OUT=/abs/out NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/redesign/adapters/__tests__/printControls.evidence.test.ts
// Writes, per path × size × v2: one contact sheet (rows = base, every size control at 2× / 3×, every switch
// OFF, shop name OFF, QR OFF) + every single sticker; preview-vs-print pairs (generic bands recomposed and the
// Niimbot image decoded next to the preview bitmap); the browser page HTML at every level.
import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS, SIZES_SHORT, screenControls, renderCase, browserCase, savePng, Sheet, sampleBuyer, settingsFor, applyModuleState, recomposeBands, AT, type CaseSpec } from "./printControls.harness";
import { buildGenericStickerBytes, buildNiimbotImage, buildNativeStickerPayload } from "../printing";
import { stickerFit } from "../stickerFit";
import type { FullRaster } from "../stickerRaster";
import type { PpBoolKey, PpSizeKey } from "../../screens/PrintPattern";
import type { Buyer } from "../../../lib/orderTypes";

const OUT = process.env.PRINTER_FIX_OUT || "";
const LABEL: Record<string, string> = { aimo: "AIMO D520BT", generic: "FLASH Y41BT / XPRINTER XP-420B (generic TSPL, bold)", niimbot: "NIIMBOT B1 (always 50x30)", browser: "LAPTOP (browser print = this image on a label-sized page)" };
it("renders the print-controls evidence", async () => {
  if (!OUT) return;
  const { switches, sizes } = screenControls();
  mkdirSync(join(OUT, "cells"), { recursive: true });
  const report: string[] = [];
  for (const path of PATHS) for (const psSize of (path === "niimbot" ? ["50x30mm"] : SIZES_SHORT)) for (const v2 of [false, true]) {
    const base: CaseSpec = { path, psSize, v2 };
    const rows: { label: string; c: CaseSpec; file: string }[] = [{ label: "BASE (all on, 1x, QR on, shop on)", c: base, file: "base" }];
    for (const k of sizes) for (const lv of [2, 3]) rows.push({ label: `${k} ${lv}x`, c: { ...base, pp: { [k]: lv } }, file: `${k}-${lv}x` });
    for (const k of switches) rows.push({ label: `${k} OFF`, c: k === "stickerQr" ? { ...base, qr: false } : { ...base, pp: { [k as PpBoolKey]: false } }, file: `${k}-off` });
    const tag = `${path}_${psSize.replace(/mm.*/, "")}_v2-${v2 ? "on" : "off"}`;
    const rasters: FullRaster[] = [];
    for (const r of rows) { const ras = await renderCase(r.c); rasters.push(ras); savePng(ras, join(OUT, "cells", `${tag}_${r.file}.png`)); }
    const cellW = Math.max(...rasters.map((r) => r.w)), cellH = Math.max(...rasters.map((r) => r.h)), cols = 4, m = 30, lab = 26;
    const nRows = Math.ceil(rows.length / cols);
    const sheet = new Sheet(m * 2 + cols * (cellW + 24), m + 60 + nRows * (cellH + lab + 24) + m);
    sheet.text(`${LABEL[path]} - ${psSize} - layout v2 ${v2 ? "ON" : "OFF"} - 1 px = 1 dot`, m, m, 1, "4");
    rows.forEach((r, i) => { const x = m + (i % cols) * (cellW + 24), y = m + 60 + Math.floor(i / cols) * (cellH + lab + 24); sheet.text(r.label, x, y, 1, "2", 50); sheet.frame(x, y + lab, rasters[i].w, rasters[i].h); sheet.raster(rasters[i], x, y + lab); });
    sheet.save(join(OUT, `sheet_${tag}.png`));
    report.push(`${tag}: ${rows.length} cells`);
  }
  // round 2 — item 1: a Chinese buyer (王小明 / 我要黑色) at 1× / 2× / 3× name and comment; item 2: the buyer number
  // 7 / 88 / 123 / 1002 at 1× / 2× / 3× (QR on) — whole digits, the largest size that fits beside the QR
  const cjk: Buyer = { ...sampleBuyer(), name: "王小明", handle: "wangxiaoming", orders: [{ ...sampleBuyer().orders[0], item: "我要黑色" }] } as Buyer;
  for (const path of PATHS) for (const psSize of (path === "niimbot" ? ["50x30mm"] : SIZES_SHORT)) for (const v2 of [false, true]) {
    const tag = `${path}_${psSize.replace(/mm.*/, "")}_v2-${v2 ? "on" : "off"}`;
    const rowsC: { label: string; c: CaseSpec; file: string }[] = [];
    for (const k of ["tiktokNameSize", "commentSize"] as const) for (const lv of [1, 2, 3]) rowsC.push({ label: `${k} ${lv}x (王小明 / 我要黑色)`, c: { path, psSize, v2, buyer: cjk, pp: { [k]: lv } }, file: `cjk_${k}-${lv}x` });
    const rowsN: { label: string; c: CaseSpec; file: string }[] = [];
    for (const num of [7, 88, 123, 1002, 12345]) for (const lv of [1, 2, 3]) rowsN.push({ label: `#${num} buyerNumSize ${lv}x`, c: { path, psSize, v2, buyer: { ...sampleBuyer(), num } as Buyer, pp: { buyerNumSize: lv } }, file: `num${num}-${lv}x` });
    for (const [kind, rows2] of [["cjk", rowsC], ["number", rowsN]] as const) {
      const rasters2: FullRaster[] = [];
      for (const r of rows2) { const ras = await renderCase(r.c); rasters2.push(ras); savePng(ras, join(OUT, "cells", `${tag}_${r.file}.png`)); }
      const cellW = Math.max(...rasters2.map((r) => r.w)), cellH = Math.max(...rasters2.map((r) => r.h)), cols = 3, m = 30, lab = 26;
      const nRows = Math.ceil(rows2.length / cols);
      const sheet = new Sheet(m * 2 + cols * (cellW + 24), m + 60 + nRows * (cellH + lab + 24) + m);
      sheet.text(`${LABEL[path]} - ${psSize} - layout v2 ${v2 ? "ON" : "OFF"} - ${kind === "cjk" ? "CHINESE name / comment 1x 2x 3x" : "BUYER NUMBER whole, never cut"} - 1 px = 1 dot`, m, m, 1, "4");
      rows2.forEach((r, i) => { const x = m + (i % cols) * (cellW + 24), y = m + 60 + Math.floor(i / cols) * (cellH + lab + 24); sheet.text(r.label.replace(/[^\x20-\x7e]/g, "?"), x, y, 1, "2", 50); sheet.frame(x, y + lab, rasters2[i].w, rasters2[i].h); sheet.raster(rasters2[i], x, y + lab); });
      sheet.save(join(OUT, `sheet_${kind}_${tag}.png`));
      report.push(`sheet_${kind}_${tag}: ${rows2.length} cells`);
    }
  }
  // preview-vs-print pairs: the print bytes recomposed next to the preview bitmap (same function → identical)
  for (const v2 of [false, true]) {
    const gc: CaseSpec = { path: "generic", psSize: "60x40mm", v2, pp: { commentSize: 2 } };
    const preview = await renderCase(gc);
    applyModuleState(gc);
    const bytes = await buildGenericStickerBytes("tspl", buildNativeStickerPayload(sampleBuyer(), "NT$", "BudgetUkay", settingsFor(gc), AT), "TikTok", false, { density: 15, speed: 4, bold: true });
    const printed = recomposeBands(bytes, preview.w, preview.h);
    const pair = new Sheet(60 + preview.w * 2 + 40, 80 + preview.h);
    pair.text(`GENERIC 60x40 v2 ${v2 ? "ON" : "OFF"}: PREVIEW (left) vs PRINT bytes recomposed (right)`, 20, 20, 1, "3");
    pair.frame(20, 60, preview.w, preview.h); pair.raster(preview, 20, 60); pair.frame(60 + preview.w, 60, printed.w, printed.h); pair.raster(printed, 60 + preview.w, 60);
    pair.save(join(OUT, `pair_generic_60x40_v2-${v2 ? "on" : "off"}.png`));
    const nc: CaseSpec = { path: "niimbot", psSize: "50x30mm", v2, pp: { buyerNumSize: 2 } };
    const np = await renderCase(nc);
    applyModuleState(nc);
    const im = await buildNiimbotImage(buildNativeStickerPayload(sampleBuyer(), "NT$", "BudgetUkay", settingsFor(nc), AT), "TikTok");
    const printedN: FullRaster = { buf: new Uint8Array(Buffer.from(im.data, "base64")), w: im.w, h: im.h, rowBytes: im.rowBytes };
    const pairN = new Sheet(60 + np.w * 2 + 40, 80 + np.h);
    pairN.text(`NIIMBOT v2 ${v2 ? "ON" : "OFF"}: PREVIEW (left) vs PRINT image (right)`, 20, 20, 1, "3");
    pairN.frame(20, 60, np.w, np.h); pairN.raster(np, 20, 60); pairN.frame(60 + np.w, 60, printedN.w, printedN.h); pairN.raster(printedN, 60 + np.w, 60);
    pairN.save(join(OUT, `pair_niimbot_v2-${v2 ? "on" : "off"}.png`));
  }
  // laptop print page (round 3, item 7): one HTML per size level (+ switches off) — open in Chrome → Print: the page IS
  // the label (@page = its size) holding the sticker bitmap; the .png next to it is that bitmap
  mkdirSync(join(OUT, "browser"), { recursive: true });
  const bc = async (file: string, c: CaseSpec) => { const r = await browserCase(c); writeFileSync(join(OUT, "browser", `${file}.html`), r.html); savePng(r.raster, join(OUT, "browser", `${file}.png`)); };
  for (const psSize of ["60x40mm", "100x60mm (Standard)"]) for (const k of sizes as PpSizeKey[]) for (const lv of [1, 2, 3]) await bc(`browser_${psSize.replace(/mm.*/, "")}_${k}-${lv}x`, { path: "browser", psSize, v2: false, pp: { [k]: lv } });
  for (const k of switches) if (k !== "stickerQr") await bc(`browser_60x40_${k}-off`, { path: "browser", psSize: "60x40mm", v2: false, pp: { [k as PpBoolKey]: false } });
  writeFileSync(join(OUT, "report.txt"), report.join("\n") + "\n");
  // item 14: the red line each size control gets at 2× / 3× (what the LIVE print pattern shows the moment it is tapped)
  const warn: string[] = [];
  for (const path of PATHS) for (const psSize of (path === "niimbot" ? ["50x30mm"] : SIZES_SHORT)) for (const v2 of [false, true]) {
    for (const k of sizes as PpSizeKey[]) for (const lv of [2, 3]) {
      const c: CaseSpec = { path, psSize, v2, pp: { [k]: lv } };
      applyModuleState(c);
      const f = await stickerFit(settingsFor(c), "NT$", "BudgetUkay", path);
      const ctl = Object.entries(f.controls).map(([ck, v]) => `${ck}=${v}`).join(",");
      warn.push(`${path} ${psSize.replace(/mm.*/, "")} v2-${v2 ? "on" : "off"} ${k} ${lv}x: ${ctl || "fits"}`);
    }
  }
  writeFileSync(join(OUT, "warnings.txt"), warn.join("\n") + "\n");
}, 900_000);
