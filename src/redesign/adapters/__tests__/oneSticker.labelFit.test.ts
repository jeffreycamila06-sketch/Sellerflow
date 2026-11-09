// LABEL OVERFLOW (XP-420B paper test 2026-11-09): the Vietnamese sample at 60×40 with the QR on put the
// "p" of "shop" 1 mm from the bottom edge and the printer fed an extra BLANK label. For EVERY picture path
// and every size: the image is never taller than the label, and no ink sits in the bottom 1.5 mm
// (BOTTOM_SAFE_DOTS) — measured on what the printer actually receives, decoded back to dots.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { printOneStickerTest, printSlip, setStickerQrEntitled, setStickerQrOn, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { recommendedSettings, screenFitNotes, worstCaseInputs, BOTTOM_SAFE_DOTS, type OneStickerSettings, type OneStickerInput } from "../oneSticker";
import { renderOneStickerFor, laptopPage, oneStickerInputFrom, oneStickerFonts, renderOptsFor } from "../oneStickerPrint";
import { setStickerAllScripts } from "../oneStickerScripts";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { ADMIN_LANG_SAMPLES, adminSampleBuyer, adminSampleInput } from "../adminLangSamples";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { decodeCpcl, decodeEscpos, decodeLaptopPage, decodeNiimbot, decodeSdkStream, decodeTsplBands } from "./oneSticker.decode";
import type { FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 8, 6, 5);
const SIZES: [number, number, boolean?][] = [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60], [40, 30, true]];
const lowestInk = (r: FullRaster): number => { for (let y = r.h - 1; y >= 0; y--) for (let b = 0; b < r.rowBytes; b++) if (r.buf[y * r.rowBytes + b]) return y; return -1; };
const cfgFor = (w: number, h: number): Settings => ({ ...DEF_SETTINGS, stickerSize: `${w}x${h}`, printerType: "bluetooth" });
const draftFor = (w: number, h: number, custom?: boolean): OneStickerSettings => { const d = recommendedSettings({ w, h }); if (custom) d.size = { w, h, custom: true }; return d; };

type Path = "d520" | "xp420b" | "y41bt" | "escpos" | "cpcl" | "niimbot";
const PATHS: Path[] = ["d520", "xp420b", "y41bt", "escpos", "cpcl", "niimbot"];
/** The picture the printer receives, as a raster in LABEL coordinates (+ the label's height in dots). */
async function sent(path: Path, send: () => unknown, wMm: number, hMm: number): Promise<{ r: FullRaster; labelH: number; imageH: number; job: OneJob }> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "xp420b") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "y41bt") rememberSavedPrinter({ address: "AA", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" });
  if (path === "escpos" || path === "cpcl") rememberSavedPrinter({ address: "AA", name: "GEN-1", model: "generic", lang: path });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" });
  if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  (window as W).SellerFlowPrinter = br;
  await send();
  const fn = path === "d520" ? "printStickerBitmap" : path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(br[fn].mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  const calls = Object.values(br).reduce((a, f) => a + f.mock.calls.length, 0); // ONE job, on one bridge call
  const arg = br[fn].mock.calls[0][0] as { data?: string; image?: { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number } };
  delete (window as W).SellerFlowPrinter;
  if (path === "niimbot") {
    const img = arg.image!;
    const r = decodeNiimbot(img);
    const inset = Math.round((img.labelHeightMm * 8 - img.h) / 2); // the SDK frame sits centred inside the paper
    const problems = oneLabelProblems(path, null, wMm, hMm, calls, img);
    return { r: { ...r, h: r.h + inset }, labelH: img.labelHeightMm * 8, imageH: img.h + 2 * inset, job: { calls, problems } };
  }
  const bytes = Uint8Array.from(Buffer.from(arg.data!, "base64"));
  const job = { calls, problems: oneLabelProblems(path, bytes, wMm, hMm, calls) };
  if (path === "d520") { const r = decodeSdkStream(bytes); return { r, labelH: hMm * 8, imageH: r.h, job }; }
  if (path === "escpos") { const r = decodeEscpos(bytes); return { r, labelH: hMm * 8, imageH: r.h, job }; }
  if (path === "cpcl") { const r = decodeCpcl(bytes); return { r, labelH: hMm * 8, imageH: r.h, job }; }
  // TSPL: SIZE must be the label; every BITMAP band must end inside it
  const txt = Buffer.from(bytes).toString("latin1");
  expect(txt).toContain(`SIZE ${wMm} mm, ${hMm} mm`);
  const bottom = Math.max(...[...txt.matchAll(/BITMAP \d+,(\d+),\d+,(\d+),0,/g)].map((m) => Number(m[1]) + Number(m[2])));
  return { r: decodeTsplBands(bytes, wMm * 8, hMm * 8 + 64), labelH: hMm * 8, imageH: bottom, job };
}

// ── ONE LABEL per sticker: the job's own framing (Jeff 2026-11-09, item 5) ─────────────────────────
interface OneJob { calls: number; problems: string[] }
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
/** TSPL commands outside the BITMAP data (the binary rows are skipped, never read as text). */
function tsplCommands(b: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < b.length) {
    let j = i; while (j < b.length && !(b[j] === 0x0d && b[j + 1] === 0x0a) && !(b[j] === 0x2c && /^BITMAP \d+,\d+,\d+,\d+,0$/.test(latin1(b.subarray(i, j))))) j++;
    const head = latin1(b.subarray(i, j));
    const m = /^BITMAP (\d+),(\d+),(\d+),(\d+),0$/.exec(head);
    if (m && b[j] === 0x2c) { out.push(head); i = j + 1 + Number(m[3]) * Number(m[4]) + 2; continue; }
    if (head) out.push(head);
    i = j + 2;
  }
  return out;
}
/** The D520 SDK stream: its text commands around ONE compressed image (LZO chunks until a 0 length). */
function sdkCommands(b: Uint8Array): string[] {
  const s = latin1(b);
  const at = s.indexOf("BITMAP 4,0,");
  const head = s.slice(0, at).split("\r\n").filter(Boolean);
  let i = s.indexOf(",4,", at) + 3; // after "BITMAP 4,0,rb,h,4,"
  for (;;) { const len = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); i += 4; if (!len) break; i += len; }
  return [...head, s.slice(at, s.indexOf(",4,", at) + 2), ...latin1(b.subarray(i)).split(/[\r\n]+/).filter(Boolean)];
}
function oneLabelProblems(path: Path, b: Uint8Array | null, w: number, h: number, calls: number, img?: { w: number; h: number; labelWidthMm: number; labelHeightMm: number }): string[] {
  const bad: string[] = [];
  if (calls !== 1) bad.push(`${calls} bridge calls`);
  const count = (list: string[], re: RegExp) => list.filter((c) => re.test(c)).length;
  if (path === "xp420b" || path === "y41bt") {
    const c = tsplCommands(b!);
    if (count(c, /^SIZE /) !== 1 || !c.includes(`SIZE ${w} mm, ${h} mm`)) bad.push(`SIZE ≠ the label: ${c.filter((x) => x.startsWith("SIZE")).join("|")}`);
    if (count(c, /^GAP /) !== 1) bad.push("GAP missing / repeated");
    if (count(c, /^CLS$/) !== 1) bad.push("CLS ≠ 1");
    if (count(c, /^PRINT /) !== 1 || c[c.length - 1] !== "PRINT 1") bad.push(`last command ≠ one "PRINT 1": ${c.slice(-2).join("|")}`);
    if (c.some((x) => /^(FORMFEED|FEED|BACKFEED|HOME|CUT)\b/.test(x))) bad.push("an extra feed / formfeed");
    for (const x of c) { const m = /^BITMAP (\d+),(\d+),(\d+),(\d+),0$/.exec(x); if (m && (Number(m[2]) + Number(m[4]) > h * 8 || Number(m[1]) + Number(m[3]) * 8 > w * 8)) bad.push(`band outside the label: ${x}`); }
  } else if (path === "d520") {
    const c = sdkCommands(b!);
    if (c[0] !== `SIZE ${w} mm,${h} mm` || count(c, /^SIZE /) !== 1) bad.push(`SIZE ≠ the label: ${c[0]}`);
    const bm = c.filter((x) => x.startsWith("BITMAP "));
    const m = bm.length === 1 ? /^BITMAP 4,0,(\d+),(\d+),4$/.exec(bm[0]) : null;
    if (!m) bad.push(`not ONE image: ${bm.join("|")}`);
    else if (Number(m[2]) > h * 8 || Number(m[1]) * 8 > w * 8) bad.push(`image ${m[1]}×${m[2]} > label`);
    if (count(c, /^PRINT /) !== 1 || c[c.length - 1] !== "PRINT 1,1") bad.push(`last ≠ one "PRINT 1,1": ${c.slice(-2).join("|")}`);
    if (c.some((x) => /^(FORMFEED|FEED|BACKFEED)\b/.test(x))) bad.push("an extra feed / formfeed");
  } else if (path === "escpos") {
    // ESC @ · GS v 0 (ONE raster image) · ESC d 3 (the one tear-off feed after it) — nothing else
    const rb = b![6] | (b![7] << 8), ih = b![8] | (b![9] << 8);
    if (latin1(b!.subarray(0, 6)) !== "\x1b@\x1dv0\x00") bad.push("not ESC @ + GS v 0");
    if (b!.length !== 10 + rb * ih + 3 || latin1(b!.subarray(b!.length - 3)) !== "\x1bd\x03") bad.push("more than one image + one feed");
    if (ih > h * 8 || rb * 8 > w * 8) bad.push(`image ${rb * 8}×${ih} > label`);
  } else if (path === "cpcl") {
    const s = latin1(b!);
    const m = /^! 0 200 200 (\d+) 1\r\nPAGE-WIDTH (\d+)\r\nEG (\d+) (\d+) 0 0 [0-9A-F]+\r\nFORM\r\nPRINT\r\n$/.exec(s);
    if (!m) bad.push("not ONE page (! 0 200 200 h 1 … FORM PRINT)");
    else if (Number(m[1]) > h * 8 || Number(m[4]) > h * 8 || Number(m[2]) > w * 8) bad.push(`page ${m[2]}×${m[1]} > label`);
  } else if (path === "niimbot") {
    if (!img || img.labelHeightMm !== h || img.labelWidthMm !== w) bad.push("label size not the label");
    else if (img.h > (h - 2) * 8 || img.w > (w - 2) * 8) bad.push(`image ${img.w}×${img.h} > the SDK frame`);
  }
  return bad;
}

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true); });
afterAll(() => { setStickerQrEntitled(false); setStickerQrOn(false); setStickerAllScripts(false); });

describe("new sticker: never taller than the label, no ink in the bottom 1.5 mm", () => {
  it("the safety is 1.5 mm (12 dots)", () => { expect(BOTTOM_SAFE_DOTS).toBe(12); });
  it("Vietnamese 60×40 on the XP-420B (the paper bug): the last line's descender stays ≥ 12 dots above the edge", async () => {
    const vi_ = ADMIN_LANG_SAMPLES.find((s) => s.key === "vi")!;
    const { r, labelH, imageH } = await sent("xp420b", () => printOneStickerTest(draftFor(60, 40), adminSampleBuyer(vi_, AT), "NT$", "My Shop", cfgFor(60, 40)), 60, 40);
    expect(imageH).toBeLessThanOrEqual(labelH);
    expect(labelH - 1 - lowestInk(r)).toBeGreaterThanOrEqual(BOTTOM_SAFE_DOTS); // was 8 dots on main
  }, 60000);
  for (const path of PATHS) {
    it(`${path}: every admin sample × every size`, async () => {
      const bad: string[] = [];
      for (const s of ADMIN_LANG_SAMPLES) for (const [w, h, custom] of SIZES) {
        if (path === "niimbot" && w > 50) continue; // the B21 takes ≤ 50 mm labels (too wide → today's sticker)
        const { r, labelH, imageH } = await sent(path, () => printOneStickerTest(draftFor(w, h, custom), adminSampleBuyer(s, AT), "NT$", "My Shop", cfgFor(w, h)), w, h);
        const margin = labelH - 1 - lowestInk(r);
        if (imageH > labelH) bad.push(`${s.key} ${w}x${h}: image ${imageH} > label ${labelH}`);
        if (margin < BOTTOM_SAFE_DOTS) bad.push(`${s.key} ${w}x${h}: ink ${margin} dots from the bottom`);
      }
      expect(bad).toEqual([]);
    }, 300000);
  }
  it("too much text (every part 2×, small labels): the print still keeps the margin, and the screen never says \"Everything fits\"", async () => {
    const bad: string[] = [];
    for (const k of ["vi", "th", "fb", "ja"]) for (const [w, h, custom] of [[50, 30], [60, 40], [40, 30, true]] as [number, number, boolean?][]) {
      const s = ADMIN_LANG_SAMPLES.find((x) => x.key === k)!;
      const d = draftFor(w, h, custom);
      for (const p of Object.values(d.parts)) p.scale = 2;
      const { r, labelH } = await sent("xp420b", () => printOneStickerTest(d, adminSampleBuyer(s, AT), "NT$", "My Shop", cfgFor(w, h)), w, h);
      if (labelH - 1 - lowestInk(r) < BOTTOM_SAFE_DOTS) bad.push(`${k} ${w}x${h}: ink in the margin`);
      const inp = adminSampleInput(s, "My Shop", AT);
      const notes = screenFitNotes(d, inp, await oneStickerFonts(d, inp), renderOptsFor("tspl", d, { bold: true }));
      if (notes.some((n) => n.kind === "ok")) bad.push(`${k} ${w}x${h}: "Everything fits" shown`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("top: a comment that is the FIRST line keeps its tall marks (Ễ Ỗ Ặ) inside the top margin, every size and scale", async () => {
    const bad: string[] = [];
    const s = { ...ADMIN_LANG_SAMPLES.find((x) => x.key === "vi")!, item: "Ễ Ỗ Ặ Ẫ Ẳ" };
    for (const [w, h, custom] of SIZES) for (const scale of [1, 1.5, 2]) {
      const d = draftFor(w, h, custom);
      for (const k of ["shop", "buyer", "name", "user"] as const) d.parts[k].on = false;
      d.qr = false; d.parts.comment.scale = scale;
      const r = await renderOneStickerFor("tspl", d, oneStickerInputFrom(adminSampleBuyer(s, AT), "My Shop", AT), { bold: true });
      let top = -1; for (let y = 0; y < r.h && top < 0; y++) for (let b = 0; b < r.rowBytes; b++) if (r.buf[y * r.rowBytes + b]) { top = y; break; }
      if (top < BOTTOM_SAFE_DOTS) bad.push(`${w}x${h} ×${scale}: ink starts at row ${top}`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("laptop: the page picture is the label size and keeps the bottom 1.5 mm clear", async () => {
    const bad: string[] = [];
    for (const s of ADMIN_LANG_SAMPLES) for (const [w, h, custom] of SIZES) {
      const d = draftFor(w, h, custom);
      const b: Buyer = adminSampleBuyer(s, AT);
      const page = laptopPage(await renderOneStickerFor("laptop", d, oneStickerInputFrom(b, "My Shop", AT, s.platform === "Facebook")), d, "t");
      const { raster, pageMm, imgMm } = decodeLaptopPage(page);
      if (imgMm[1] > pageMm[1] || raster.h > h * 8) bad.push(`${s.key} ${w}x${h}: image taller than the page`);
      if (h * 8 - 1 - lowestInk(raster) < BOTTOM_SAFE_DOTS) bad.push(`${s.key} ${w}x${h}: ink in the bottom margin`);
    }
    expect(bad).toEqual([]);
  }, 300000);
});

// extra stress for today's layouts (guardian, 2026-11-09): marks UNDER letters in the last comment row
const STRESS: { key: string; name: string; handle: string; item: string }[] = [
  { key: "th-short", name: "สมใจ ใจดี", handle: "somjai", item: "ชุดสีดำ 2 ตัว ขอบคุณค่ะ" },
  { key: "th-long", name: "สมใจ ใจดี", handle: "somjai", item: "ชุดสีดำ ไซส์ M 2 ตัว ขอบคุณค่ะ ฝากด้วยนะคะ ฤดูร้อน" },
  { key: "ko-long", name: "김민지", handle: "minji", item: "검정 원피스 두 개 주세요 감사합니다 정말" },
  { key: "ar-long", name: "فاطمة أحمد", handle: "fatima", item: "فستان أسود مقاس M شكرا جزيلا يا أختي" },
];
const stressBuyer = (x: (typeof STRESS)[number]): Buyer => adminSampleBuyer({ key: x.key, label: x.key, num: 88, name: x.name, handle: x.handle, platform: "TikTok", item: x.item }, AT);
describe("today's sticker with the all-scripts language fix: the same check", () => {
  for (const path of ["d520", "xp420b", "escpos", "cpcl", "niimbot"] as Path[]) {
    it(`${path}: every admin sample + the stress comments × every size (Vietnamese / Thai marks included)`, async () => {
      setStickerAllScripts(true);
      const bad: string[] = [];
      const sizes = path === "niimbot" ? [[50, 30]] : SIZES.filter(([, , c]) => !c);
      const buyers: [string, Buyer][] = [...ADMIN_LANG_SAMPLES.map((s) => [s.key, adminSampleBuyer(s, AT)] as [string, Buyer]), ...STRESS.map((x) => [x.key, stressBuyer(x)] as [string, Buyer])];
      for (const [key, b] of buyers) for (const [w, h] of sizes) {
        const s = { key };
        const { r, labelH, imageH } = await sent(path, () => printSlip(b, "NT$", "My Shop", cfgFor(w, h), { noOneSticker: true }), w, h);
        const margin = labelH - 1 - lowestInk(r);
        if (imageH > labelH) bad.push(`${s.key} ${w}x${h}: image ${imageH} > label ${labelH}`);
        if (margin < BOTTOM_SAFE_DOTS) bad.push(`${s.key} ${w}x${h}: ink ${margin} dots from the bottom`);
      }
      setStickerAllScripts(false);
      expect(bad).toEqual([]);
    }, 300000);
  }
});

// ONE LABEL ON EVERY PRINTER (Jeff 2026-11-09, item 5): every path sends ONE job for ONE sticker — the
// picture no bigger than the label, no ink in the bottom 12 dots, and exactly one print / feed:
//   D520 (Android SPP and iPhone BLE get the SAME printStickerBitmap stream — the transports only chunk it):
//        SIZE = label · ONE compressed BITMAP ≤ label · ONE "PRINT 1,1" last · no FORMFEED / FEED
//   Flash Y41BT / Xprinter XP-420B (TSPL): SIZE = label · GAP · ONE CLS · bands inside the label · ONE "PRINT 1"
//        last · no FORMFEED / FEED / BACKFEED
//   generic ESC/POS: ESC @ · ONE GS v 0 image ≤ label · ONE ESC d 3 (its one feed) · nothing else
//   generic CPCL: ONE page "! 0 200 200 h 1" (h ≤ label) · ONE EG image · FORM · PRINT
//   Niimbot B1/B21: ONE printStickerImage, label size = the label, image ≤ the SDK frame
//   laptop: ONE @page W×H mm holding ONE picture W×H mm (checked in the laptop test above)
const buyerOf = (inp: OneStickerInput, i: number): Buyer => adminSampleBuyer({ key: `w${i}`, label: `w${i}`, num: 8888, name: inp.name ?? "", handle: inp.handle ?? "", platform: inp.platform ?? "TikTok", item: inp.items[0] ?? "" }, AT);
const ONE_LABEL_BUYERS = (): [string, Buyer][] => [...ADMIN_LANG_SAMPLES.map((s) => [s.key, adminSampleBuyer(s, AT)] as [string, Buyer]), ...worstCaseInputs({ date: "", items: ["đầm đen gói kỹ giúp shop nhé ụ ợ ỵ pqg"] }).map((inp, i) => [`worst${i}`, buyerOf(inp, i)] as [string, Buyer])];
describe("one label on every printer: one job, one print / feed, picture ≤ label, bottom 12 dots clear", () => {
  for (const path of PATHS.concat(["y41bt"] as Path[]).filter((p, i, a) => a.indexOf(p) === i)) {
    it(`${path}: new sticker — admin samples + worst-case buyers × sizes × scale 1 / 2 × QR on / off`, async () => {
      const bad: string[] = [];
      for (const [key, b] of ONE_LABEL_BUYERS()) for (const [w, h, custom] of SIZES) for (const scale of [1, 2]) for (const qr of [true, false]) {
        if (path === "niimbot" && w > 50) continue;
        if (!qr && b.platform === "Facebook") continue;
        const d = draftFor(w, h, custom);
        d.qr = qr;
        if (scale !== 1) for (const k of ["buyer", "name", "user"] as const) d.parts[k].scale = scale;
        const { r, labelH, imageH, job } = await sent(path, () => printOneStickerTest(d, b, "NT$", "My Shop", cfgFor(w, h)), w, h);
        const tag = `${key} ${w}x${h} ×${scale} qr=${qr}`;
        for (const p of job.problems) bad.push(`${tag}: ${p}`);
        if (imageH > labelH) bad.push(`${tag}: image ${imageH} > label ${labelH}`);
        if (labelH - 1 - lowestInk(r) < BOTTOM_SAFE_DOTS) bad.push(`${tag}: ink ${labelH - 1 - lowestInk(r)} dots from the bottom`);
      }
      expect(bad).toEqual([]);
    }, 600000);
  }
  for (const path of ["d520", "xp420b", "y41bt", "escpos", "cpcl", "niimbot"] as Path[]) {
    it(`${path}: today's sticker (switch OFF and with the all-scripts letters) — one job, one print / feed, picture ≤ label`, async () => {
      const bad: string[] = [];
      const sizes = path === "niimbot" ? [[50, 30]] : SIZES.filter(([, , c]) => !c);
      for (const scripts of [false, true]) {
        setStickerAllScripts(scripts);
        for (const [key, b] of ONE_LABEL_BUYERS()) for (const [w, h] of sizes) {
          const { labelH, imageH, job } = await sent(path, () => printSlip(b, "NT$", "My Shop", cfgFor(w, h), { noOneSticker: true }), w, h);
          for (const p of job.problems) bad.push(`${key} ${w}x${h} scripts=${scripts}: ${p}`);
          if (imageH > labelH) bad.push(`${key} ${w}x${h} scripts=${scripts}: image ${imageH} > label ${labelH}`);
        }
      }
      setStickerAllScripts(false);
      expect(bad).toEqual([]);
    }, 600000);
  }
});
