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

const OUT = process.env.PRINTER_FIX_OUT || "";
const LABEL: Record<string, string> = { aimo: "AIMO D520BT", generic: "FLASH Y41BT / XPRINTER XP-420B (generic TSPL, bold)", niimbot: "NIIMBOT B1 (always 50x30)" };
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
  // browser page: one HTML per size level (+ switches off) — open in Chrome → Print to see the laptop sticker
  mkdirSync(join(OUT, "browser"), { recursive: true });
  for (const k of sizes as PpSizeKey[]) for (const lv of [1, 2, 3]) writeFileSync(join(OUT, "browser", `browser_${k}-${lv}x.html`), browserCase({ path: "aimo", psSize: "60x40mm", v2: false, pp: { [k]: lv } }));
  for (const k of switches) if (k !== "stickerQr") writeFileSync(join(OUT, "browser", `browser_${k}-off.html`), browserCase({ path: "aimo", psSize: "60x40mm", v2: false, pp: { [k as PpBoolKey]: false } }));
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
});
