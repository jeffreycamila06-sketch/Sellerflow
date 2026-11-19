// "FREE" on the sticker (Choose price → Free button). A Free order is an ordinary order whose ITEM
// TEXT is "FREE" — no print path was changed. This file proves, on what each printer RECEIVES, that
// FREE prints where a price prints and fits, on every path and size:
//   · picture paths (AIMO D520, generic TSPL / ESC-POS / CPCL, Niimbot 50×30) — today's sticker AND
//     the new sticker, 50×30 … 100×60, QR off and on: the "FREE" picture differs from the "150"
//     picture ONLY in the price's own place; the FREE letters are measured by themselves (also on the
//     50×30 / 60×40 small-label layouts), are not smaller than the price, and stay clear of the edges.
//     Today's sticker is drawn the way the app prints it (word spacing ON for everyone), in the usual
//     layout AND the newer small-label layout (admins / listed accounts), at Comment size 1×, 2×, 3×.
//   · a buyer with TWO orders (Print screen): FREE takes exactly the room a price takes — which
//     orders show on a size is today's rule (printing map row 26), FREE never changes it.
//   · Facebook buyer (2-line name), Chinese name, a past-session Reprint.
//   · text sticker (old Bluetooth / iPhone WiFi sticker): the printer commands are the same except
//     the word itself.
//   · laptop: today's page is the same except the word; the new sticker's page picture as above.
// PICTURES: SFL_FREE_PICTURES=<folder> npx vitest run freeSticker.proof  → writes, per path and size,
// one PNG with TODAY ("150") on the left and NEW ("FREE") on the right, the two laptop pages as HTML
// and measurements.txt. Without the variable nothing is written (CI).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { printOneStickerTest, printSlip, setStickerQrEntitled, setStickerQrOn, setStickerSpacingAllowed, setStickerCompactV2, DEF_SETTINGS, __resetNativePrintQueue, __resetWebPrintQueue, type Settings } from "../printing";
import { recommendedSettings } from "../oneSticker";
import { renderOneStickerFor, laptopPage, oneStickerInputFrom } from "../oneStickerPrint";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { renderStickerBitmap, type FullRaster, type RasterPayload } from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { decodeCpcl, decodeEscpos, decodeLaptopPage, decodeNiimbot, decodeSdkStream, decodeTsplBands } from "./oneSticker.decode";
import { buildTsplStickerReference, type RefPayload } from "../../../lib/__tests__/tsplReference";
import { buildGbkEncoder } from "../../../lib/__tests__/gbk";
import { FREE_ITEM } from "../../../lib/freeOrder";
import type { Buyer } from "../../../lib/orderTypes";

const OUT = process.env.SFL_FREE_PICTURES || "";
type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 19, 6, 5);                       // 14:05 Taipei
const SIZES: [number, number][] = [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60]];
const TEXT_SIZES: [number, number][] = [[60, 40], [70, 50], [80, 50], [80, 60], [100, 60]];   // the text sticker has no 50×30
type Path = "d520" | "tspl" | "escpos" | "cpcl" | "niimbot";
const PATHS: Path[] = ["d520", "tspl", "escpos", "cpcl", "niimbot"];
const NAME: Record<Path, string> = { d520: "AIMO D520", tspl: "Xprinter / Flash (TSPL)", escpos: "generic ESC-POS", cpcl: "generic CPCL", niimbot: "Niimbot" };
const PRICE = "150";
const cfgFor = (w: number, h: number, comment = 1): Settings => ({ ...DEF_SETTINGS, stickerSize: `${w}x${h}`, printerType: "bluetooth", printCommentScale: comment });
type Who = { name: string; handle: string; platform: string };
const MARIA: Who = { name: "Maria Santos", handle: "maria_live", platform: "TikTok" };
const order = (who: Who, item: string, price: number, n = 0) => ({ orderNum: AT + n * 60000, item, qty: 1, price, total: price, time: n ? "14:06" : "14:05", handle: who.handle, name: who.name, bNum: 128, platform: who.platform, status: "New", date: "2026-11-19" });
/** One buyer with the given [item, price] orders (one = a Live sticker; two = the Print screen). */
const buyerOf = (who: Who, ...items: [string, number][]): Buyer => ({ handle: who.handle, name: who.name, platform: who.platform, num: 128, totalOrders: items.length, totalSpent: items.reduce((a, x) => a + x[1], 0),
  orders: items.map(([item, price], n) => order(who, item, price, n)) });
const buyer = (item: string, price: number): Buyer => buyerOf(MARIA, [item, price]);
const priced = () => buyer(PRICE, 150);
const free = () => buyer(FREE_ITEM, 0);

/** The picture the printer receives for one print, in label dots (bit 1 = ink). */
async function sent(path: Path, send: () => unknown, wMm: number, hMm: number): Promise<FullRaster> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "tspl") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "escpos" || path === "cpcl") rememberSavedPrinter({ address: "AA", name: "GEN-1", model: "generic", lang: path });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" });
  if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  (window as W).SellerFlowPrinter = br;
  await send();
  const fn = path === "d520" ? "printStickerBitmap" : path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(br[fn].mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  expect(Object.values(br).reduce((a, f) => a + f.mock.calls.length, 0)).toBe(1);   // ONE job
  const arg = br[fn].mock.calls[0][0] as { data?: string; image?: { w: number; h: number; rowBytes: number; data: string } };
  delete (window as W).SellerFlowPrinter;
  if (path === "niimbot") return decodeNiimbot(arg.image!);
  const bytes = Uint8Array.from(Buffer.from(arg.data!, "base64"));
  if (path === "d520") return decodeSdkStream(bytes);
  if (path === "escpos") return decodeEscpos(bytes);
  if (path === "cpcl") return decodeCpcl(bytes);
  return decodeTsplBands(bytes, wMm * 8, hMm * 8);
}

// ── measuring ──
interface Box { x0: number; y0: number; x1: number; y1: number }
const px = (r: FullRaster, x: number, y: number) => (x < r.w && y < r.h ? (r.buf[y * r.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 : 0);
const NONE: Box = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
const grow = (b: Box, x: number, y: number): Box => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) });
/** Where the two pictures differ = the place of the price / the word (nothing else may move). */
function diffBox(a: FullRaster, b: FullRaster): Box {
  let d = NONE;
  for (let y = 0; y < Math.max(a.h, b.h); y++) for (let x = 0; x < Math.max(a.w, b.w); x++) if (px(a, x, y) !== px(b, x, y)) d = grow(d, x, y);
  return d;
}
/** The ink of ONE picture inside that place = the word's own letters. */
function inkIn(r: FullRaster, d: Box): Box {
  let k = NONE;
  for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) if (px(r, x, y)) k = grow(k, x, y);
  return k;
}
const wOf = (b: Box) => b.x1 - b.x0 + 1, hOf = (b: Box) => b.y1 - b.y0 + 1;
const mm = (dots: number) => (dots / 8).toFixed(1);

// ── a small PNG writer (grey, 8-bit) for the TODAY | NEW pictures ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w: number, h: number, grey: Uint8Array): Buffer {
  const chunk = (type: string, data: Uint8Array) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h); for (let y = 0; y < h; y++) Buffer.from(grey.buffer, grey.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}
/** TODAY (left) | NEW (right): each sticker on white with a thin outline, on a grey page. */
function pairPng(a: FullRaster, b: FullRaster): Buffer {
  const pad = 12, gap = 24, W = pad + a.w + 2 + gap + b.w + 2 + pad, H = pad + Math.max(a.h, b.h) + 2 + pad;
  const g = new Uint8Array(W * H).fill(0xd8);
  const put = (r: FullRaster, ox: number) => {
    for (let y = -1; y <= r.h; y++) for (let x = -1; x <= r.w; x++) {
      const edge = y < 0 || x < 0 || y === r.h || x === r.w;
      g[(pad + 1 + y) * W + ox + 1 + x] = edge ? 0x70 : px(r, x, y) ? 0x00 : 0xff;
    }
  };
  put(a, pad); put(b, pad + a.w + 2 + gap);
  return png(W, H, g);
}
const rows: string[] = [];
const save = (file: string, a: FullRaster, b: FullRaster) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${file}.png`, pairPng(a, b)); } };

/** The shared check: `b` (with FREE) against `a` (with a price in the same place). Returns the two words' boxes. */
function sameButTheWord(a: FullRaster, b: FullRaster): { f: Box; p: Box } {
  expect([b.w, b.h]).toEqual([a.w, a.h]);                         // same picture size
  const d = diffBox(a, b);
  expect(d.x1, "the two pictures differ").toBeGreaterThan(-1);
  const f = inkIn(b, d), p = inkIn(a, d);
  // ONE line changed: the place where they differ is no taller than the word itself (+2 dots)
  expect(hOf(d)).toBeLessThanOrEqual(Math.max(hOf(f), hOf(p)) + 2);
  // FREE is not printed smaller than the price, and starts where the price starts
  expect(hOf(f)).toBeGreaterThanOrEqual(hOf(p) - 2);
  expect(Math.abs(f.x0 - p.x0)).toBeLessThanOrEqual(4);
  // …and it is whole: ≥ 1 mm from the right edge and ≥ 1 mm from the bottom of the picture
  expect(b.w - 1 - f.x1).toBeGreaterThanOrEqual(8);
  expect(b.h - 1 - f.y1).toBeGreaterThanOrEqual(8);
  return { f, p };
}
const line = (kind: string, where: string, size: string, how: string, b: FullRaster, f: Box, p: Box) =>
  `${kind.padEnd(5)} | ${where.padEnd(24)} | ${size.padEnd(6)} | ${how.padEnd(34)} | picture ${b.w}x${b.h} dots | FREE ${wOf(f)}x${hOf(f)} dots = ${mm(wOf(f))}x${mm(hOf(f))} mm at x ${f.x0}-${f.x1}, y ${f.y0}-${f.y1} | "150" ${wOf(p)}x${hOf(p)} dots at x ${p.x0}-${p.x1} | right edge free ${mm(b.w - 1 - f.x1)} mm, bottom free ${mm(b.h - 1 - f.y1)} mm`;

// Today's sticker the way the app prints it: word spacing is ON for every seller (STICKER_SPACING_PUBLIC).
beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerSpacingAllowed(true); });
afterEach(() => { setStickerCompactV2(false); });
afterAll(() => {
  setStickerQrEntitled(false); setStickerQrOn(false); setStickerSpacingAllowed(false); setStickerCompactV2(false);
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/measurements.txt`, rows.join("\n") + "\n"); }
});
const today = (path: Path, w: number, h: number, b: Buyer, o: { newer?: boolean; comment?: number; qr?: boolean; at?: number } = {}) => {
  setStickerQrOn(!!o.qr); setStickerCompactV2(!!o.newer);
  return sent(path, () => printSlip(b, "NT$", "My Shop", cfgFor(w, h, o.comment ?? 1), { noOneSticker: true, ...(o.at != null ? { at: o.at } : {}) }), w, h);
};
const fresh = (path: Path, w: number, h: number, b: Buyer, o: { comment?: number; qr?: boolean } = {}) => {
  const d = recommendedSettings({ w, h });
  const s = { ...d, qr: !!o.qr && d.qr, parts: { ...d.parts, comment: { ...d.parts.comment, scale: o.comment ?? 1 } } };
  setStickerQrOn(!!o.qr);
  return sent(path, () => printOneStickerTest(s, b, "NT$", "My Shop", cfgFor(w, h)), w, h);
};
const eachPathSize = (fn: (path: Path, w: number, h: number) => void) => { for (const path of PATHS) for (const [w, h] of SIZES) { if (path === "niimbot" && !(w === 50 && h === 30)) continue; fn(path, w, h); } }; // Niimbot B1 / B21 take 50×30

describe("today's sticker — FREE prints in the price's place and fits (measured on the FREE letters themselves)", () => {
  for (const newer of [false, true]) for (const comment of [1, 2, 3]) for (const qr of [false, true]) eachPathSize((path, w, h) => {
    const how = `${newer ? "newer layout" : "usual layout"}, comment ${comment}×, QR ${qr ? "on" : "off"}`;
    it(`${NAME[path]} · ${w}×${h} · ${how}`, async () => {
      const a = await today(path, w, h, priced(), { newer, comment, qr }), b = await today(path, w, h, free(), { newer, comment, qr });
      const { f, p } = sameButTheWord(a, b);
      rows.push(line("today", NAME[path], `${w}x${h}`, how, b, f, p));
      if (!qr && comment === 1) save(`${newer ? "today-newer" : "today"}_${path}_${w}x${h}`, a, b);
      if (!qr && !newer && comment === 3 && path === "d520") save(`today_d520_${w}x${h}_comment-x3`, a, b);
    }, 60000);
  });
});

describe("new sticker — FREE prints in the price's place and fits", () => {
  for (const comment of [1, 2]) for (const qr of [false, true]) eachPathSize((path, w, h) => {
    const how = `comment ${comment}×, QR ${qr ? "on" : "off"}`;
    it(`${NAME[path]} · ${w}×${h} · ${how}`, async () => {
      const a = await fresh(path, w, h, priced(), { comment, qr }), b = await fresh(path, w, h, free(), { comment, qr });
      const { f, p } = sameButTheWord(a, b);
      rows.push(line("new", NAME[path], `${w}x${h}`, how, b, f, p));
      if (!qr && comment === 1) save(`new_${path}_${w}x${h}`, a, b);
    }, 60000);
  });
});

// The Print screen prints ONE sticker for a buyer with several orders. Which orders show on a size is
// today's rule (printing map row 26: e.g. the first order only on 50×30 and on the laptop page, two
// rows on the bigger AIMO labels, every item on the new sticker). FREE never changes that rule: put a
// price in FREE's place and the sticker is the same except that one word.
describe("a buyer with a FREE order and a priced order (Print screen)", () => {
  const two = (first: [string, number], second: [string, number]) => buyerOf(MARIA, first, second);
  const CASES: [string, Buyer, Buyer][] = [
    ["FREE-then-150", two(["200", 200], [PRICE, 150]), two([FREE_ITEM, 0], [PRICE, 150])],
    ["150-then-FREE", two([PRICE, 150], ["200", 200]), two([PRICE, 150], [FREE_ITEM, 0])],
  ];
  const same = (x: FullRaster, y: FullRaster) => x.w === y.w && x.h === y.h && diffBox(x, y).x1 < 0;
  for (const [label, withPrice, withFree] of CASES) for (const kind of ["today", "new"] as const) for (const path of ["d520", "tspl"] as Path[]) for (const [w, h] of SIZES) {
    it(`${kind} · ${NAME[path]} · ${w}×${h} · ${label}`, async () => {
      const go = (b: Buyer) => (kind === "today" ? today(path, w, h, b) : fresh(path, w, h, b));
      const a = await go(withPrice), b = await go(withFree);
      // Is FREE's order on this sticker at all? Only if a price in its place would change the picture.
      const freeShown = !same(a, b);
      if (label === "FREE-then-150") expect(freeShown).toBe(true);         // the first order is always printed
      if (freeShown) {
        const d = diffBox(a, b), f = inkIn(b, d), p = inkIn(a, d);
        expect(hOf(d)).toBeLessThanOrEqual(Math.max(hOf(f), hOf(p)) + 2);     // one word changed, nothing else moved
        expect(b.w - 1 - f.x1).toBeGreaterThanOrEqual(8);
        expect(b.h - 1 - f.y1).toBeGreaterThanOrEqual(8);
      }
      // …and the OTHER order: on the sticker only if changing ITS text changes the picture
      const otherShown = label === "FREE-then-150" ? !same(b, await go(two([FREE_ITEM, 0], ["999", 999]))) : !same(b, await go(two(["999", 999], [FREE_ITEM, 0])));
      const shows = freeShown && otherShown ? "both orders" : freeShown ? "FREE only — the 150 order is not on this sticker (first order only)" : "150 only — the FREE order is not on this sticker (first order only)";
      rows.push(`${kind.padEnd(5)} | ${NAME[path].padEnd(24)} | ${`${w}x${h}`.padEnd(6)} | two orders, ${label}: this size shows ${shows}`);
      if (path === "d520") save(`two-orders_${kind}_${label}_${w}x${h}`, a, b);
    }, 60000);
  }
});

describe("other buyers — Facebook (2-line name), Chinese name, a past-session Reprint", () => {
  const FB: Who = { name: "Maria Consolacion Dela Cruz Santos-Villanueva", handle: "Maria Consolacion Dela Cruz Santos-Villanueva", platform: "Facebook" };
  const ZH: Who = { name: "陳小美", handle: "chen_xiaomei", platform: "TikTok" };
  for (const [tag, who] of [["facebook", FB], ["chinese-name", ZH]] as [string, Who][]) for (const kind of ["today", "new"] as const) for (const path of ["d520", "tspl"] as Path[]) for (const [w, h] of [[50, 30], [60, 40], [100, 60]] as [number, number][]) {
    it(`${tag} · ${kind} · ${NAME[path]} · ${w}×${h}`, async () => {
      const go = (b: Buyer) => (kind === "today" ? today(path, w, h, b) : fresh(path, w, h, b));
      const a = await go(buyerOf(who, [PRICE, 150])), b = await go(buyerOf(who, [FREE_ITEM, 0]));
      const { f, p } = sameButTheWord(a, b);
      rows.push(line(kind, NAME[path], `${w}x${h}`, tag, b, f, p));
      save(`${tag}_${kind}_${path}_${w}x${h}`, a, b);
    }, 60000);
  }
  it("a past-session Reprint (the sticker carries the order's own date): the same, only the word", async () => {
    const at = AT - 3 * 86400000;
    const a = await today("d520", 60, 40, priced(), { at }), b = await today("d520", 60, 40, free(), { at });
    const { f, p } = sameButTheWord(a, b);
    rows.push(line("today", NAME.d520, "60x40", "past-session reprint", b, f, p));
    save("reprint-past-session_today_d520_60x40", a, b);
  }, 60000);
});

describe("text sticker (old Bluetooth sticker, iPhone WiFi sticker) — the same commands, only the word differs", () => {
  const gbk = buildGbkEncoder();
  const payload = (b: Buyer): RefPayload => ({ storeName: "My Shop", sessionDate: "11/19/2026", currency: "NT$", buyer: b as unknown as RefPayload["buyer"],
    settings: { printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printTotal: false } });
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  for (const [w, h] of TEXT_SIZES) it(`${w}×${h}`, () => {
    const a = text(buildTsplStickerReference(payload(priced()), w, h, gbk)), b = text(buildTsplStickerReference(payload(free()), w, h, gbk));
    expect(a).toContain(`"${PRICE}"`);
    expect(b).toBe(a.replace(`"${PRICE}"`, `"${FREE_ITEM}"`));          // same position, same letter size
    const cmd = b.split("\r\n").find((l) => l.endsWith(`"${FREE_ITEM}"`))!;
    const m = /^TEXT (\d+),(\d+),"4",0,(\d+),(\d+),/.exec(cmd)!;
    const right = Number(m[1]) + FREE_ITEM.length * 24 * Number(m[3]);  // font "4": 24 dots per letter × the width step
    expect(right).toBeLessThanOrEqual(w * 8 - 16);
    rows.push(`text  | text sticker (commands)  | ${`${w}x${h}`.padEnd(6)} | ${cmd} | ends at dot ${right} of ${w * 8} (right edge free ${mm(w * 8 - right)} mm)`);
    // a picture of that layout, drawn with the app's own letters (the printer's built-in letters differ a little)
    const draw = (bb: Buyer) => renderStickerBitmap(payload(bb) as unknown as RasterPayload, w, h, { latin: LATIN_ATLAS, cjk: null as never }, "legacy");
    save(`text_${w}x${h}`, draw(priced()), draw(free()));
  });
});

describe("laptop — today's page", () => {
  let captured: HTMLIFrameElement | null;
  beforeEach(() => {
    captured = null; __resetWebPrintQueue(); __resetSavedPrinter(); vi.useFakeTimers();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") captured = el as HTMLIFrameElement; return el; });
  });
  afterEach(() => { __resetWebPrintQueue(); vi.restoreAllMocks(); vi.useRealTimers(); document.querySelectorAll("iframe").forEach((x) => x.remove()); });
  const page = (b: Buyer) => { captured = null; __resetWebPrintQueue(); printSlip(b, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "100x60" }, { noOneSticker: true }); return captured!.contentDocument!.documentElement.outerHTML; };

  for (const qr of [false, true]) it(`QR ${qr ? "on" : "off"}: the same page, only the word differs (it is the big line at the bottom)`, () => {
    setStickerQrOn(qr);
    const a = page(priced()), b = page(free());
    expect(a.includes("<svg")).toBe(qr);                                // the QR state really is what the name says
    expect(a).toContain(`<div class="code">${PRICE}</div>`);
    expect(b).toBe(a.replace(`<div class="code">${PRICE}</div>`, `<div class="code">${FREE_ITEM}</div>`));
    const tag = qr ? "qr-on" : "qr-off";
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/laptop-today-150_${tag}.html`, "<!DOCTYPE html>" + a); writeFileSync(`${OUT}/laptop-today-FREE_${tag}.html`, "<!DOCTYPE html>" + b); }
  });
  it("two orders on the laptop page: the first order only (today's rule) — FREE first prints FREE, FREE second is not on the page", () => {
    setStickerQrOn(false);
    const m = MARIA;
    expect(page(buyerOf(m, [FREE_ITEM, 0], [PRICE, 150]))).toContain(`<div class="code">${FREE_ITEM}</div>`);
    const second = page(buyerOf(m, [PRICE, 150], [FREE_ITEM, 0]));
    expect(second).toContain(`<div class="code">${PRICE}</div>`);
    expect(second).not.toContain(FREE_ITEM);
    rows.push(`today | laptop page (browser)    | any    | two orders: the page shows the first order only (FREE first → FREE; FREE second → not on the page)`);
  });
});

describe("laptop — the new sticker's page picture", () => {
  for (const qr of [false, true]) for (const [w, h] of SIZES) it(`${w}×${h} · QR ${qr ? "on" : "off"}`, async () => {
    const base = recommendedSettings({ w, h });
    const d = { ...base, qr: qr && base.qr };
    const pic = async (b: Buyer) => decodeLaptopPage(laptopPage(await renderOneStickerFor("laptop", d, oneStickerInputFrom(b, "My Shop", AT, false)), d, "t"));
    const a = await pic(priced()), b = await pic(free());
    expect(b.pageMm).toEqual([w, h]);
    const { f, p } = sameButTheWord(a.raster, b.raster);
    rows.push(line("new", "laptop page", `${w}x${h}`, `QR ${d.qr ? "on" : "off"}`, b.raster, f, p));
    save(`new_laptop_${w}x${h}_${d.qr ? "qr-on" : "qr-off"}`, a.raster, b.raster);
  }, 60000);
});
