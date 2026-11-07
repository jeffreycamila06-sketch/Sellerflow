// PROOF PICTURES for Branch 1 (docs/design/one-sticker/). Skipped unless ONE_STICKER_PROOF_DIR is set:
//   ONE_STICKER_PROOF_DIR=docs/design/one-sticker SFL_PROOF_FONTS=<dir with Noto Sans KR/Arabic> \
//   LAPTOP_HTML_DIR=<scratch> npx vitest run src/redesign/adapters/__tests__/oneSticker.proof.test.ts
// Every picture here is the 1-bit picture a printer receives (or the preview of it), drawn by the SAME
// functions the print uses. The laptop pictures are taken separately by Playwright from the real print
// page (scripts in docs/design/one-sticker/README.md).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recommendedSettings, renderOneSticker, type OneStickerSettings, type PartKey, type Weight } from "../oneSticker";
import { oneStickerInputFrom, renderOptsFor, oneStickerFonts, laptopPage, type OneStickerPath } from "../oneStickerPrint";
import { knownTsplJob } from "../printerModels";
import { fbNameOnly, printableBuyer } from "../fbName";
import { buildNativeStickerPayload, buildNiimbotImage, setStickerQrEntitled, setStickerQrOn, DEF_SETTINGS, printSlip, __resetWebPrintQueue } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState } from "../oneStickerPrint";
import { setStickerAllScripts } from "../oneStickerScripts";
import { decodeSdkStream, decodeEscpos } from "./oneSticker.decode";
import { buildGenericStickerBytes, __resetNativePrintQueue, setStickerSpacingAllowed, setStickerSpacingChoice, type Settings } from "../printing";
import { __resetSavedPrinter } from "../savedPrinter";
import type { FullRaster } from "../stickerRaster";
import { installNodeFallbackDrawer, installSans, napiCanvas } from "./oneSticker.harness";
import { READ_SAMPLES } from "./oneSticker.samples";
import { SAMPLES, SIZES } from "./oneSticker.samples";
import type { Buyer } from "../../../lib/orderTypes";

const OUT = process.env.ONE_STICKER_PROOF_DIR;
const HTML_OUT = process.env.LAPTOP_HTML_DIR;
const AT = Date.UTC(2026, 10, 7, 6, 5);

type Ctx = { fillStyle: string; font: string; fillRect(x: number, y: number, w: number, h: number): void; fillText(t: string, x: number, y: number): void; drawImage(i: unknown, x: number, y: number, w?: number, h?: number): void };
function sheet(cells: { title: string; r: FullRaster; frameW?: number; frameH?: number }[], cols: number, scale: number, head: string): Buffer {
  const n = napiCanvas()!;
  const cw = Math.max(...cells.map((c) => (c.frameW ?? c.r.w))) * scale + 24, chh = Math.max(...cells.map((c) => (c.frameH ?? c.r.h))) * scale + 46;
  const rowsN = Math.ceil(cells.length / cols);
  const cv = n.createCanvas(cw * cols + 16, chh * rowsN + 64);
  const ctx = cv.getContext("2d") as unknown as Ctx;
  ctx.fillStyle = "#eef0f5"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#1c1a35"; ctx.font = 'bold 22px "DejaVu Sans", "Noto Sans JP"'; ctx.fillText(head, 14, 34);
  cells.forEach((c, i) => {
    const x0 = 8 + (i % cols) * cw + 12, y0 = 56 + Math.floor(i / cols) * chh;
    ctx.fillStyle = "#1c1a35"; ctx.font = '15px "DejaVu Sans", "Noto Sans JP"'; ctx.fillText(c.title, x0, y0 + 16);
    const fw = (c.frameW ?? c.r.w), fh = (c.frameH ?? c.r.h);
    ctx.fillStyle = "#9aa3b2"; ctx.fillRect(x0 - 2, y0 + 24, fw * scale + 4, fh * scale + 4);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x0, y0 + 26, fw * scale, fh * scale);
    const ox = Math.floor((fw - c.r.w) / 2), oy = Math.floor((fh - c.r.h) / 2);
    ctx.fillStyle = "#111111";
    for (let y = 0; y < c.r.h; y++) for (let x = 0; x < c.r.w; x++) if (c.r.buf[y * c.r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) ctx.fillRect(x0 + (x + ox) * scale, y0 + 26 + (y + oy) * scale, scale, scale);
  });
  return (cv as unknown as { toBuffer(m: string): Buffer }).toBuffer("image/png");
}
async function render(path: OneStickerPath, s: OneStickerSettings, buyer: Buyer, shop: string, job = {}): Promise<FullRaster> {
  const pb = printableBuyer(buyer);
  const inp = oneStickerInputFrom(pb, shop, AT, fbNameOnly(pb.platform, pb.name));
  return renderOneSticker(s, inp, await oneStickerFonts(s, inp), renderOptsFor(path, s, job));
}
const sizeOf = (w: number, h: number): OneStickerSettings["size"] => ({ w, h, ...((w === 40 && h === 30) || (w === 75 && h === 45) ? { custom: true } : {}) });
const write = (rel: string, buf: Buffer) => { const p = path.join(OUT!, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); };

describe.skipIf(!OUT)("one sticker — proof pictures", () => {
  it("stickers: every size × sample × printer", async () => {
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true);
    const families: { key: string; title: string; path: OneStickerPath; job?: object; sizes: [number, number][] }[] = [
      { key: "aimo-d520", title: "AIMO / Phomemo D520BT (SDK image)", path: "d520", sizes: SIZES },
      { key: "generic-y41bt-xp420b", title: "Flash Y41BT / Xprinter XP-420B (TSPL image, density 15, speed 4, 1-dot ink)", path: "tspl", job: knownTsplJob("XP-420B"), sizes: SIZES },
      { key: "niimbot", title: "Niimbot (B1/B21/B203 up to 50 mm wide, B3S up to 75 mm) — SDK frame 1 mm inside the label", path: "niimbot", sizes: SIZES.filter(([w]) => w <= 75) },
    ];
    for (const f of families) for (const [w, h] of f.sizes) {
      const cells = [];
      for (const smp of SAMPLES) {
        const s = { ...recommendedSettings(sizeOf(w, h)), qr: smp.qr };
        const r = await render(f.path, s, smp.buyer, smp.shop, f.job ?? {});
        cells.push({ title: smp.key, r, frameW: w * 8, frameH: h * 8 });
      }
      write(`stickers/${f.key}/${w}x${h}.png`, sheet(cells, 4, w >= 80 ? 1 : 2, `${f.title} — ${w}×${h} mm${(w === 40 || w === 75) && (h === 30 || h === 45) ? " (custom)" : ""}`));
    }
    // laptop: the real print pages (Playwright takes the pictures from these)
    if (HTML_OUT) for (const [w, h] of SIZES) for (const smp of SAMPLES) {
      const s = { ...recommendedSettings(sizeOf(w, h)), qr: smp.qr };
      const r = await render("laptop", s, smp.buyer, smp.shop);
      fs.mkdirSync(HTML_OUT, { recursive: true });
      fs.writeFileSync(path.join(HTML_OUT, `${w}x${h}_${smp.key}.html`), laptopPage(r, s, `Sticker #${smp.buyer.num}`));
      fs.writeFileSync(path.join(HTML_OUT, `${w}x${h}_${smp.key}.raw`), Buffer.from(JSON.stringify({ w: r.w, h: r.h, rowBytes: r.rowBytes, buf: Buffer.from(r.buf).toString("base64") })));
    }
  }, 600000);

  it("controls: each part at 0.6× / 1× / 2×, Normal / Bold / Extra, OFF (100×60 and 60×40)", async () => {
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true);
    const smp = SAMPLES[0];
    const names: Record<PartKey, string> = { shop: "Shop name", buyer: "Buyer #", name: "Name", user: "@username", comment: "Comment / Price" };
    for (const [w, h] of [[100, 60], [60, 40]] as [number, number][]) for (const k of Object.keys(names) as PartKey[]) {
      const cells = [];
      const base = () => recommendedSettings({ w, h });
      for (const scale of [0.6, 1, 2]) { const s = base(); s.parts[k].scale = scale; cells.push({ title: `${scale}×`, r: await render("d520", s, smp.buyer, smp.shop) }); }
      for (const weight of ["normal", "bold", "extra"] as Weight[]) { const s = base(); s.parts[k].weight = weight; cells.push({ title: weight === "normal" ? "Normal" : weight === "bold" ? "Bold" : "Extra", r: await render("d520", s, smp.buyer, smp.shop) }); }
      { const s = base(); s.parts[k].on = false; cells.push({ title: "OFF", r: await render("d520", s, smp.buyer, smp.shop) }); }
      write(`controls/${w}x${h}_${k}.png`, sheet(cells, 4, w >= 80 ? 1 : 2, `${names[k]} — ${w}×${h} mm${k === "shop" && w === 60 ? "" : ""}`));
    }
  }, 300000);

  it("readability guard: every script × 50×30 / 60×40 / 100×60 × Normal / Bold / Extra — BEFORE (no guard) vs AFTER, per printer", async () => {
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true);
    const printers: { key: string; title: string; path: OneStickerPath; job: { bold?: boolean } }[] = [
      { key: "aimo-d520", title: "AIMO D520", path: "d520", job: {} },
      { key: "y41bt-xp420b", title: "Y41BT / XP-420B (1-dot ink)", path: "tspl", job: { bold: true } },
      { key: "niimbot", title: "Niimbot", path: "niimbot", job: {} },
      { key: "laptop", title: "Laptop", path: "laptop", job: {} },
    ];
    for (const pr of printers) for (const [w, h] of [[50, 30], [60, 40], [100, 60]] as [number, number][]) {
      if (pr.path === "niimbot" && w > 75) continue;
      const cells = [];
      for (const k of Object.keys(READ_SAMPLES)) for (const weight of ["normal", "bold", "extra"] as Weight[]) {
        const s = recommendedSettings({ w, h }); s.qr = false;
        for (const p of ["shop", "buyer", "name", "user", "comment"] as const) s.parts[p].weight = weight;
        const inp = { storeName: "Maria Ukay Shop", date: "11/07", time: "14:05", buyerNum: 128, name: READ_SAMPLES[k].name, handle: "maria_live", platform: "TikTok", items: READ_SAMPLES[k].items };
        const fonts = await oneStickerFonts(s, inp);
        const opts = renderOptsFor(pr.path, s, pr.job);
        const label = weight === "normal" ? "Normal" : weight === "bold" ? "Bold" : "Extra";
        cells.push({ title: `${k} ${label} — BEFORE`, r: renderOneSticker(s, inp, fonts, { ...opts, guard: false }), frameW: w * 8, frameH: h * 8 });
        cells.push({ title: `${k} ${label} — AFTER (printed)`, r: renderOneSticker(s, inp, fonts, opts), frameW: w * 8, frameH: h * 8 });
      }
      write(`readability/${pr.key}_${w}x${h}.png`, sheet(cells, 6, w >= 80 ? 1 : 2, `Readability guard — ${pr.title} ${w}×${h}: the seller's weight (BEFORE) vs what prints (AFTER: lighter only where letters would close; never resized)`));
    }
  }, 900000);

  it("TODAY vs NEW: Japan client — Niimbot 50×30 田中さん", async () => {
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true);
    const smp = SAMPLES.find((s) => s.key === "japanese")!;
    const np = buildNativeStickerPayload(smp.buyer, "NT$", smp.shop, { ...DEF_SETTINGS, stickerSize: "50x30" }, AT);
    const today = await buildNiimbotImage(np, smp.buyer.platform);
    const todayR: FullRaster = { w: today.w, h: today.h, rowBytes: today.rowBytes, buf: Uint8Array.from(Buffer.from(today.data, "base64")) };
    const s = recommendedSettings({ w: 50, h: 30 });
    const now = await render("niimbot", s, smp.buyer, smp.shop);
    write("today-vs-new/niimbot_50x30_tanaka.png", sheet([{ title: "TODAY (田中さん → 田中, 「ワンピース」１２３ dropped)", r: todayR, frameW: 400, frameH: 240 }, { title: "NEW (every character prints)", r: now, frameW: 400, frameH: 240 }], 2, 3, "Japan client — Niimbot 50×30, 田中さん「ワンピース」１２３"));
    setStickerQrOn(false);
  }, 120000);

  it("font: our Sans raster vs Noto Sans drawn by the browser engine (Skia), 400 / 700 / 900 + Chinese", async () => {
    installSans(); installNodeFallbackDrawer();
    const n = napiCanvas()!;
    const s = recommendedSettings({ w: 100, h: 60 });
    const cells = [];
    for (const weight of ["normal", "bold", "extra"] as Weight[]) {
      const st: OneStickerSettings = { ...s, qr: false, parts: { shop: { on: false, weight, scale: 1 }, buyer: { on: true, weight, scale: 1 }, name: { on: true, weight, scale: 1.3 }, user: { on: true, weight, scale: 1 }, comment: { on: true, weight, scale: 1.3 } } };
      const b = { ...SAMPLES[0].buyer, name: "Amy Chen 陳小美", orders: [{ ...SAMPLES[0].buyer.orders[0], item: "Nguyễn Мария 350 さん" }] } as Buyer;
      cells.push({ title: `ours (TS outlines) — ${weight}`, r: await render("laptop", st, b, "") });
      // the same words drawn by Skia with the original Noto Sans font, thresholded the same way
      const cv = n.createCanvas(800, 480);
      const ctx = cv.getContext("2d") as unknown as Ctx & { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 800, 480); ctx.fillStyle = "#000";
      const wt = weight === "normal" ? 400 : weight === "bold" ? 700 : 900;
      ctx.font = `${wt} 112px "Noto Sans"`; ctx.fillText("12", 92, 120);
      ctx.font = `${wt} 78px "Noto Sans"`; ctx.fillText("Amy Chen", 12, 220);
      ctx.font = `${wt} 78px "Noto Sans"`; ctx.fillText("Nguyễn Мария 350", 12, 330);
      const d = ctx.getImageData(0, 0, 800, 480).data; const rb = 100; const buf = new Uint8Array(rb * 480);
      for (let y = 0; y < 480; y++) for (let x = 0; x < 800; x++) if (d[(y * 800 + x) * 4] < 128) buf[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
      cells.push({ title: `Noto Sans by Skia — ${wt}`, r: { w: 800, h: 480, rowBytes: rb, buf } });
    }
    write("font/sans_ours_vs_skia.png", sheet(cells, 2, 1, "One font: Sans (Noto Sans 400/700/900, CJK from the Noto Sans CJK cells, kana from Noto Sans TC) — ours vs the browser engine"));
  }, 120000);

  it("TODAY vs NEW: customer case — laptop 100×60, long comment (the two real print pages)", async () => {
    if (!HTML_OUT) return;
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true);
    const smp = SAMPLES.find((x) => x.key === "long-comment")!;
    const grab = async (): Promise<string> => {
      __resetWebPrintQueue(); delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter;
      let frame: HTMLIFrameElement | null = null;
      const orig = document.createElement.bind(document);
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
      printSlip(smp.buyer, "NT$", smp.shop, { ...DEF_SETTINGS, stickerSize: "100x60" }, { at: AT });
      await vi.waitFor(() => expect((frame as HTMLIFrameElement | null)?.contentDocument?.body?.innerHTML ?? "").not.toBe(""));
      await new Promise((r) => setTimeout(r, 50));
      const html = "<!DOCTYPE html>" + (frame as unknown as HTMLIFrameElement).contentDocument!.documentElement.outerHTML;
      spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
      return html;
    };
    const dir = path.join(HTML_OUT, "..", "tvn"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "today_laptop_100x60_long-comment.html"), await grab());
    setOneStickerVisible(true); saveOneSticker(recommendedSettings({ w: 100, h: 60 }));
    fs.writeFileSync(path.join(dir, "new_laptop_100x60_long-comment.html"), await grab());
    __resetOneStickerState(); setStickerQrOn(false);
  }, 120000);

  // what the AIMO D520BT RECEIVES for this buyer at this size (decoded), with the current switches
  async function d520Received(b: Buyer, shop: string, size: string): Promise<FullRaster> {
    __resetNativePrintQueue(); __resetSavedPrinter();
    const ok = () => vi.fn(async () => ({ ok: true }));
    const br: Record<string, ReturnType<typeof vi.fn>> = { printStickerNative: ok(), printStickerBitmap: ok() };
    (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = br;
    const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: size };
    printSlip(b, "NT$", shop, cfg, { at: AT });
    await vi.waitFor(() => expect(br.printStickerBitmap.mock.calls.length).toBe(1), { timeout: 20000 });
    delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter;
    return decodeSdkStream(Uint8Array.from(Buffer.from((br.printStickerBitmap.mock.calls[0][0] as { data: string }).data, "base64")));
  }
  const ALL_SCRIPT_KEYS = ["japanese", "korean", "thai", "arabic", "bulgarian"];
  const apostrophe = { key: "apostrophe-dash", shop: "Maria Ukay Shop", buyer: { ...SAMPLES[0].buyer, name: "O’Brien Ana–Maria", orders: [{ ...SAMPLES[0].buyer.orders[0], item: "Joy… “A2” 350" }] } as Buyer, qr: false };

  it("ALL SCRIPTS on TODAY's layouts — OFF vs ON (D520 every size, generic 50×30 / 60×40, Niimbot 50×30)", async () => {
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(false);
    setStickerSpacingAllowed(true); setStickerSpacingChoice("compact"); // production: sticker spacing is public (half word gaps + compact)
    const samples = [...SAMPLES.filter((x) => ALL_SCRIPT_KEYS.includes(x.key)), apostrophe];
    for (const size of ["100x60", "80x60", "80x50", "70x50", "60x40", "50x30"]) {
      const cells = [];
      for (const smp of samples) for (const on of [false, true]) {
        setStickerAllScripts(on);
        cells.push({ title: `${smp.key} — ${on ? "ON" : "OFF (today)"}`, r: await d520Received(smp.buyer, smp.shop, size) });
      }
      setStickerAllScripts(false);
      const [w] = size.split("x").map(Number);
      write(`all-scripts-today-layouts/aimo-d520_${size}.png`, sheet(cells, 4, w >= 80 ? 1 : 2, `TODAY's AIMO D520 sticker, ${size.replace("x", "×")} — all-scripts switch OFF vs ON (what the printer receives)`));
    }
    for (const size of ["50x30", "60x40"]) {
      const cells = [];
      for (const smp of samples) for (const on of [false, true]) {
        setStickerAllScripts(on);
        const np = buildNativeStickerPayload(smp.buyer, "NT$", smp.shop, { ...DEF_SETTINGS, stickerSize: size }, AT);
        cells.push({ title: `${smp.key} — ${on ? "ON" : "OFF (today)"}`, r: decodeEscpos(await buildGenericStickerBytes("escpos", np, smp.buyer.platform)) });
      }
      setStickerAllScripts(false);
      write(`all-scripts-today-layouts/generic_${size}.png`, sheet(cells, 4, 2, `TODAY's generic-printer sticker (Y41BT / XP-420B picture), ${size.replace("x", "×")} — all-scripts OFF vs ON`));
    }
    {
      const cells = [];
      for (const smp of samples) for (const on of [false, true]) {
        setStickerAllScripts(on);
        const np = buildNativeStickerPayload(smp.buyer, "NT$", smp.shop, { ...DEF_SETTINGS, stickerSize: "50x30" }, AT);
        const im = await buildNiimbotImage(np, smp.buyer.platform);
        cells.push({ title: `${smp.key} — ${on ? "ON" : "OFF (today)"}`, r: { w: im.w, h: im.h, rowBytes: im.rowBytes, buf: Uint8Array.from(Buffer.from(im.data, "base64")) }, frameW: 400, frameH: 240 });
      }
      setStickerAllScripts(false);
      write("all-scripts-today-layouts/niimbot_50x30.png", sheet(cells, 4, 2, "TODAY's Niimbot sticker, 50×30 — all-scripts OFF vs ON"));
    }
  }, 600000);

  it("TODAY vs NEW on the AIMO D520 — every size (long comment, Facebook 2-line name, 中文)", async () => {
    installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true);
    setStickerSpacingAllowed(true); setStickerSpacingChoice("compact"); // production settings for TODAY's sticker
    const picks = ["long-comment", "facebook-long-name", "chinese"].map((k) => SAMPLES.find((x) => x.key === k)!);
    for (const size of ["100x60", "80x60", "80x50", "70x50", "60x40", "50x30"]) {
      const [w, h] = size.split("x").map(Number);
      const cells = [];
      for (const smp of picks) {
        __resetOneStickerState();
        cells.push({ title: `${smp.key} — TODAY`, r: await d520Received(smp.buyer, smp.shop, size), frameW: w * 8, frameH: h * 8 });
        setOneStickerVisible(true); saveOneSticker({ ...recommendedSettings({ w, h }), qr: true });
        cells.push({ title: `${smp.key} — NEW`, r: await d520Received(smp.buyer, smp.shop, size), frameW: w * 8, frameH: h * 8 });
        __resetOneStickerState();
      }
      write(`today-vs-new/aimo-d520_${size}.png`, sheet(cells, 2, w >= 80 ? 1 : 2, `AIMO D520 ${size.replace("x", "×")} — TODAY vs NEW (what the printer receives; QR on)`));
    }
    setStickerQrOn(false);
  }, 600000);
});
