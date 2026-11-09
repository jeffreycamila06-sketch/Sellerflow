// REAL-BROWSER check (Jeff 2026-11-09, XP-420B extra blank labels): every sticker picture job, drawn with the
// browser's OWN fonts (Korean / Arabic / Thai come from the device font — the Node tests use a stand-in), is
// captured as the bytes the printer receives and checked: one bridge call per sticker, SIZE = the label, one
// PRINT, no feed / re-sync command, nothing taller than the label, ≥ 12 dots clear at the bottom. Plus: fast
// taps never put two jobs on the printer at once. Run: node scripts/printing-browser-check.mjs (Chromium).
import { printOneStickerTest, printSlip, setStickerQrEntitled, setStickerQrOn, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../../src/redesign/adapters/printing";
import { recommendedSettings } from "../../src/redesign/adapters/oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../../src/redesign/adapters/savedPrinter";
import { ADMIN_LANG_SAMPLES, ADMIN_DEFAULT_SAMPLE, adminSampleBuyer } from "../../src/redesign/adapters/adminLangSamples";
import { checkStickerJob, checkNiimbotImage, tsplCommands, type JobKind } from "../../src/redesign/adapters/stickerJobGuard";

type W = Window & { SellerFlowPrinter?: Record<string, unknown>; __RESULTS?: unknown };
type Printer = "xp420b" | "y41bt" | "d520" | "escpos" | "cpcl" | "niimbot";
const SAVED: Record<Printer, Parameters<typeof rememberSavedPrinter>[0]> = {
  xp420b: { address: "AA", name: "XP-420B", model: "generic", lang: "tspl" }, y41bt: { address: "AA", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" },
  d520: { address: "AA", name: "D520BT-Z" }, escpos: { address: "AA", name: "GEN-1", model: "generic", lang: "escpos" },
  cpcl: { address: "AA", name: "GEN-1", model: "generic", lang: "cpcl" }, niimbot: { address: "AA", name: "B21-C123", transport: "niimbot" },
};
const KIND: Record<Exclude<Printer, "niimbot">, JobKind> = { xp420b: "tspl", y41bt: "tspl", d520: "d520", escpos: "escpos", cpcl: "cpcl" };
const b64 = (d: string) => Uint8Array.from(atob(d), (c) => c.charCodeAt(0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function capture(printer: Printer, send: () => unknown) {
  __resetNativePrintQueue(); __resetSavedPrinter(); rememberSavedPrinter(SAVED[printer]);
  const calls: { fn: string; arg: Record<string, unknown> }[] = [];
  const rec = (fn: string) => async (arg: Record<string, unknown>) => { calls.push({ fn, arg }); return { ok: true }; };
  (window as W).SellerFlowPrinter = { printStickerNative: rec("printStickerNative"), printStickerBitmap: rec("printStickerBitmap"), printRawTspl: rec("printRawTspl"), printStickerImage: rec("printStickerImage") };
  await send();
  const t0 = performance.now(); while (!calls.length && performance.now() - t0 < 20000) await sleep(20);
  await sleep(150);
  delete (window as W).SellerFlowPrinter;
  return calls;
}
function problemsOf(printer: Printer, calls: { fn: string; arg: Record<string, unknown> }[], w: number, h: number): { problems: string[]; numbers: Record<string, unknown> } {
  if (calls.length !== 1) return { problems: [`${calls.length} bridge calls`], numbers: {} };
  const { fn, arg } = calls[0];
  if (printer === "niimbot") {
    const img = arg.image as { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number };
    return { problems: [...(fn !== "printStickerImage" ? [`sent via ${fn}`] : []), ...checkNiimbotImage(img, img.labelWidthMm * 8 - 16, img.labelHeightMm * 8 - 16)], numbers: { image: `${img.w}x${img.h}` } };
  }
  const bytes = b64(arg.data as string);
  const problems = [...(printer === "d520" ? (fn !== "printStickerBitmap" ? [`sent via ${fn}`] : []) : (fn !== "printRawTspl" ? [`sent via ${fn}`] : [])), ...checkStickerJob(KIND[printer], bytes, w, h)];
  const numbers: Record<string, unknown> = { bytes: bytes.length };
  if (KIND[printer] === "tspl") {
    const { cmds, bands } = tsplCommands(bytes);
    numbers.commands = cmds.filter((c) => !c.startsWith("BITMAP"));
    numbers.bands = bands.map((b) => `${b.y}+${b.h}`);
    // the lowest ink row from the band data
    let low = -1, i = 0;
    const s = Array.from(bytes, (c) => String.fromCharCode(c)).join("");
    for (const b of bands) {
      i = s.indexOf(`BITMAP ${b.x},${b.y},${b.rowBytes},${b.h},0,`, i);
      const at = i + `BITMAP ${b.x},${b.y},${b.rowBytes},${b.h},0,`.length;
      for (let r = 0; r < b.h; r++) for (let k = 0; k < b.rowBytes; k++) if (bytes[at + r * b.rowBytes + k]) { low = Math.max(low, b.y + r); break; }
      i = at + b.rowBytes * b.h;
    }
    numbers.inkLow = low;
    if (h * 8 - 1 - low < 12) problems.push(`ink ${h * 8 - 1 - low} dots from the bottom`);
  }
  return { problems, numbers };
}
(async () => {
  const out: unknown[] = [];
  const AT = Date.UTC(2026, 10, 8, 6, 5);
  const samples = [ADMIN_DEFAULT_SAMPLE, ...ADMIN_LANG_SAMPLES];
  const plan: [Printer, number, number][] = [];
  for (const p of ["xp420b", "d520"] as Printer[]) for (const [w, h] of [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60]]) plan.push([p, w, h]);
  for (const p of ["y41bt", "escpos", "cpcl"] as Printer[]) for (const [w, h] of [[50, 30], [60, 40], [80, 50]]) plan.push([p, w, h]);
  plan.push(["niimbot", 50, 30]);
  for (const qr of [true, false]) {
    setStickerQrEntitled(qr); setStickerQrOn(qr);
    for (const [printer, w, h] of plan) for (const s of samples) {
      const cfg = { ...DEF_SETTINGS, stickerSize: `${w}x${h}`, printerType: "bluetooth" } as Settings;
      const d = recommendedSettings({ w, h }); d.qr = qr;
      const n = await capture(printer, () => printOneStickerTest(d, adminSampleBuyer(s, AT), "NT$", "My Shop", cfg));
      out.push({ route: "new", printer, size: `${w}x${h}`, qr, key: s.key, ...problemsOf(printer, n, w, h) });
      if (qr) {
        const t = await capture(printer, () => printSlip(adminSampleBuyer(s, AT), "NT$", "My Shop", cfg, { noOneSticker: true }));
        const lab = printer === "niimbot" ? [50, 30] : [w, h];
        out.push({ route: "today", printer, size: `${w}x${h}`, qr, key: s.key, ...problemsOf(printer, t, lab[0], lab[1]) });
      }
    }
  }
  // fast taps: the whole admin language test tapped at once on an XP-420B. Like the native single-flight
  // generic BLE transport, the fake printer REFUSES a job while another is sending (BT_BUSY) — that sticker
  // never prints. Each job takes 2.5 s (BLE send + settle); the gap before the next connect is measured.
  __resetNativePrintQueue(); __resetSavedPrinter(); rememberSavedPrinter(SAVED.xp420b);
  let inFlight = 0, jobs = 0, busy = 0, lastEnd = 0, minGap = Infinity;
  (window as W).SellerFlowPrinter = { printStickerNative: async () => ({ ok: true }), printStickerBitmap: async () => ({ ok: true }),
    printRawTspl: async () => {
      if (inFlight) { busy++; return { ok: false, code: "BT_BUSY", message: "printer busy" }; }
      if (lastEnd) minGap = Math.min(minGap, performance.now() - lastEnd);
      inFlight++; jobs++; await sleep(2500); inFlight--; lastEnd = performance.now(); return { ok: true };
    } };
  const cfg = { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" } as Settings;
  printSlip(adminSampleBuyer(samples[0], AT), "NT$", "My Shop", cfg); // an order printing at the same time
  const taps = await Promise.all(ADMIN_LANG_SAMPLES.map((s) => printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), adminSampleBuyer(s, AT), "NT$", "My Shop", cfg)));
  await sleep(4000);
  const want = ADMIN_LANG_SAMPLES.length + 1;
  out.push({ route: "fast-taps", printer: "xp420b", size: "60x40", numbers: { jobs, busy, failedTaps: taps.filter((r) => !r.ok).length, minGapMs: Math.round(minGap) },
    problems: [...(busy ? [`${busy} job(s) refused BT_BUSY (another sticker was still sending)`] : []), ...(jobs !== want ? [`${jobs} labels for ${want} stickers`] : []), ...(minGap < 1400 ? [`next connect ${Math.round(minGap)} ms after the last job`] : [])] });
  delete (window as W).SellerFlowPrinter;
  (window as W).__RESULTS = { ua: navigator.userAgent, cases: out };
})();
