// LIVE sticker layout v2 (order time up top, full-width comment) — bitmap path only.
//  1. NEW GOLDENS (flag ON): 60×40 / 70×50 / 80×50 / 80×60 × QR off/on × the two sample
//     comments, sha256-pinned on the production SDK stream (real Latin + CJK atlases).
//     Regenerate deliberately: UPDATE_V2_GOLDENS=1 npx vitest run stickerRaster.v2
//     PNG previews (today vs v2): V2_PNG_DIR=/some/dir npx vitest run stickerRaster.v2
//  2. FLAG OFF / multi-order / legacy → byte-identical to today for every existing fixture.
//  3. Layout rules: time slot, full width, wrap, whitespace, QR keep-out, bottom margin,
//     Total, collision fallback, no ellipsis.
//  4. Router gate: the flag reaches the raster only for allowed (admin) sessions.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  stickerDrawOps, rasterizeToBitmapTspl, rasterizeToSdkBitmapTspl, renderStickerBitmap, stickerQrPlacement,
  wrapCommentV2, V2_TIME_X, V2_TIME_Y, V2_BOTTOM_MARGIN, STICKER_LAYOUTS, QR_TEXT_KEEPOUT_GAP,
  type RasterPayload, type RasterAtlases, type DrawOp, type FullRaster,
} from "../stickerRaster";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CJK_ATLAS } from "../glyphAtlas.cjk";
import { extraBitmapFixtures } from "./bitmapFixtures";
import { printStickerBtRouted, setStickerLayoutV2Allowed, stickerLayoutV2Effective, STICKER_LAYOUT_V2_PUBLIC, DEF_SETTINGS, buildNativeStickerPayload, stickerQrEffective } from "../printing";

const LATIN_SAMPLE = "ako   si  jeff pa reserve po yung black na dress size M thank you po";
const CJK_SAMPLE = "+1 我要這件黑色 size M 2件 pls reserve 老闆娘 thank you so much";
const LATIN_SAMPLE_2 = "ako si jeff pa reserve po yung black na size M";
const CJK_SAMPLE_2 = "+1 我要這件黑色 size M 2件 pls reserve 老闆娘";
const isCjk = (ch: string) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
const charW = (ch: string) => (isCjk(ch) ? 48 : 32);
const SIZES: [number, number][] = [[60, 40], [70, 50], [80, 50], [80, 60]];
const AT: RasterAtlases = { latin: LATIN_ATLAS, cjk: CJK_ATLAS };
const GOLDENS = join(process.cwd(), "src/redesign/adapters/__tests__/stickerRasterV2Goldens.json");
const PARITY_DIR = join(process.cwd(), "mobile/ios/tspl-parity/");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const payload = (item: string, o: { qr?: boolean; v2?: boolean; store?: string; total?: boolean } = {}): RasterPayload => ({
  storeName: o.store ?? "Budgetukay2", sessionDate: "09/30/2026", currency: "NT$",
  buyer: { num: 12, name: "Maria Santos", handle: "maria_live", totalSpent: 350, orders: [{ time: "14:05", item }] },
  settings: {
    printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printTotal: o.total ?? false,
    printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1, printTotalScale: 1,
    printStickerQr: o.qr ?? false, ...(o.v2 === false ? {} : { printCommentFullWidth: true }),
  },
});
const fixtures = () => SIZES.flatMap(([w, h]) => [false, true].flatMap((qr) => (
  [["latin", LATIN_SAMPLE], ["cjk", CJK_SAMPLE], ["latin2", LATIN_SAMPLE_2], ["cjk2", CJK_SAMPLE_2]] as const).map(([k, c]) => ({ key: `v2_${k}_${w}x${h}${qr ? "_qr" : ""}`, w, h, qr, item: c }))));

// ── 1. goldens ───────────────────────────────────────────────────────────────
describe("v2 goldens (flag ON, sha256 of the production SDK stream)", () => {
  it("matches the committed v2 goldens", () => {
    const built: Record<string, string> = {};
    for (const f of fixtures()) { const r = rasterizeToSdkBitmapTspl(payload(f.item, { qr: f.qr }), f.w, f.h, AT); built[f.key] = `${sha(r.bytes)}:${r.bytes.length}`; }
    if (process.env.UPDATE_V2_GOLDENS === "1" || !existsSync(GOLDENS)) writeFileSync(GOLDENS, JSON.stringify(built, null, 2) + "\n");
    expect(built).toEqual(JSON.parse(readFileSync(GOLDENS, "utf8")));
    if (process.env.V2_PNG_DIR) writePreviews(process.env.V2_PNG_DIR);
  });
});

// ── 2. flag off / not applicable → today's bytes ────────────────────────────
interface Fx { name: string; labelWidthMm: number; labelHeightMm: number }
const manifest: { fixtures: Fx[] } = JSON.parse(readFileSync(`${PARITY_DIR}manifest.json`, "utf8"));
const readPayload = (n: string) => JSON.parse(readFileSync(`${PARITY_DIR}payloads/${n}.json`, "utf8")) as RasterPayload;
const withFlag = (p: RasterPayload, v: boolean): RasterPayload => ({ ...p, settings: { ...(p.settings ?? {}), printCommentFullWidth: v } });

describe("flag OFF is byte-identical to today (every existing golden payload)", () => {
  const all = () => [
    ...manifest.fixtures.map((f) => ({ name: f.name, p: readPayload(f.name), w: f.labelWidthMm, h: f.labelHeightMm })),
    ...extraBitmapFixtures().map((f) => ({ name: f.key, p: f.payload, w: f.w, h: f.h })),
  ];
  it("printCommentFullWidth:false == no flag (bands + SDK stream)", () => {
    for (const f of all()) {
      expect(sha(rasterizeToBitmapTspl(withFlag(f.p, false), f.w, f.h, AT).bytes)).toBe(sha(rasterizeToBitmapTspl(f.p, f.w, f.h, AT).bytes));
      expect(sha(rasterizeToSdkBitmapTspl(withFlag(f.p, false), f.w, f.h, AT).bytes)).toBe(sha(rasterizeToSdkBitmapTspl(f.p, f.w, f.h, AT).bytes));
    }
  });
  it("flag ON but more than one order (Print screen) → today's layout, byte-identical", () => {
    let multi = 0;
    for (const f of all()) {
      if ((f.p.buyer?.orders?.length ?? 0) === 1) continue;
      multi++;
      expect(sha(rasterizeToBitmapTspl(withFlag(f.p, true), f.w, f.h, AT).bytes)).toBe(sha(rasterizeToBitmapTspl(f.p, f.w, f.h, AT).bytes));
    }
    const two = payload(CJK_SAMPLE); two.buyer!.orders!.push({ time: "14:07", item: "A350" });
    expect(sha(rasterizeToBitmapTspl(two, 80, 50, AT).bytes)).toBe(sha(rasterizeToBitmapTspl(withFlag(two, false), 80, 50, AT).bytes));
    expect(multi).toBeGreaterThan(0);
  });
  it("legacy mode (Classic-text parity / emitTextTspl) ignores the flag", () => {
    for (const f of all()) expect(stickerDrawOps(withFlag(f.p, true), f.w, f.h, "legacy").ops).toEqual(stickerDrawOps(f.p, f.w, f.h, "legacy").ops);
  });
  it("the flag never enters the native (TEXT) payload", () => {
    const np = buildNativeStickerPayload({ ...(payload("x").buyer as object), orders: [{ orderNum: 1, item: "x", time: "14:05" }] } as never, "NT$", "S", DEF_SETTINGS);
    expect(JSON.stringify(np)).not.toContain("printCommentFullWidth");
  });
});

// ── 3. layout rules ──────────────────────────────────────────────────────────
const cellH = (op: DrawOp) => (op.k === "cjk" ? 24 * op.ym : op.k === "txt" ? ({ "2": 20, "3": 24, "4": 32 } as const)[op.font] * op.ym : op.h);
const cellW = (op: DrawOp) => (op.k === "cjk" ? [...op.s].length * 24 * op.xm : op.k === "txt" ? [...op.s].length * ({ "2": 12, "3": 16, "4": 24 } as const)[op.font] * op.xm : op.w);
const opsOf = (p: RasterPayload, w: number, h: number) => {
  const qr = stickerQrPlacement(p, STICKER_LAYOUTS[`${w}x${h}`].wDots, h * 8, h);
  return { ops: stickerDrawOps(p, w, h, "extended", qr).ops, qr };
};
const commentOps = (ops: DrawOp[]) => { const sep = ops.find((o) => o.k === "bar" && o.x === 16 && o.h === 2) as { y: number }; return ops.filter((o) => o.k !== "bar" && o.y > sep.y && !(o.k === "txt" && o.font === "2")); };

describe("v2 layout rules", () => {
  it("time sits under the header bar at the date's x (same font 2), not in the order rows", () => {
    for (const [w, h] of SIZES) {
      const { ops } = opsOf(payload(LATIN_SAMPLE), w, h);
      const times = ops.filter((o) => o.k === "txt" && o.s === "14:05");
      expect(times).toEqual([{ k: "txt", x: V2_TIME_X, y: V2_TIME_Y, font: "2", s: "14:05", xm: 1, ym: 1 }]);
    }
  });
  it("comment starts at the left margin, runs full width, normal glyph shapes (Latin font 3 / CJK at 2×pm both ways), whitespace collapsed, no word split, no ellipsis", () => {
    for (const [w, h] of SIZES) for (const sample of [LATIN_SAMPLE, CJK_SAMPLE, LATIN_SAMPLE_2, CJK_SAMPLE_2]) {
      const { ops } = opsOf(payload(sample), w, h);
      const runs = commentOps(ops);
      expect(runs.length).toBeGreaterThan(0);
      for (const o of runs) {
        if (o.k === "txt") { expect(o.font).toBe("3"); expect([o.xm, o.ym]).toEqual([2, 2]); expect([...o.s].some(isCjk)).toBe(false); }
        else if (o.k === "cjk") { expect([o.xm, o.ym]).toEqual([2, 2]); expect([...o.s].every(isCjk)).toBe(true); }
      }
      const c = STICKER_LAYOUTS[`${w}x${h}`];
      for (const o of runs) expect(o.x + cellW(o)).toBeLessThanOrEqual(c.rightEdge);
      // each line starts at the left margin; runs sit back to back at the per-char widths
      const byLine = new Map<number, DrawOp[]>();
      for (const o of runs) byLine.set(o.y, [...(byLine.get(o.y) ?? []), o]);
      const lines: string[] = [];
      for (const lineOps of byLine.values()) {
        lineOps.sort((x, y) => x.x - y.x);
        expect(lineOps[0].x).toBe(16);
        let text = "", x = 16;
        for (const o of lineOps) { const t = (o as { s: string }).s; text += " ".repeat(Math.round((o.x - x) / 32)) + t; x = o.x + cellW(o); }
        lines.push(text.trim());
      }
      // in order, nothing lost or reordered (a Chinese word may break across lines, so compare without spaces)
      expect(sample.replace(/\s+/g, "").startsWith(lines.join("").replace(/\s+/g, ""))).toBe(true);
      for (const l of lines) expect(l).not.toMatch(/ {2}|…|\.\.\./);
      if (!/[\u4e00-\u9fff]/.test(sample)) { const words = new Set(sample.split(/\s+/)); for (const l of lines) for (const wd of l.split(" ")) expect(words.has(wd)).toBe(true); }
    }
  });
  it("more text than today: every sample fits more characters than today's single 12-char row", () => {
    for (const [w, h] of SIZES) for (const s of [LATIN_SAMPLE, CJK_SAMPLE]) {
      const v2 = commentOps(opsOf(payload(s), w, h).ops).reduce((n, o) => n + [...(o as { s: string }).s].length, 0);
      const today = commentOps(opsOf(payload(s, { v2: false }), w, h).ops).reduce((n, o) => n + [...(o as { s: string }).s].length, 0);
      expect(v2).toBeGreaterThan(today);
    }
  });
  it("mixed Chinese + English on one line: separate runs, each at the right x (CJK 48, Latin 32 per char)", () => {
    const { ops } = opsOf(payload("我要 size M 黑色"), 80, 60);
    const runs = commentOps(ops).filter((o) => o.y === commentOps(ops)[0].y).sort((a, b) => a.x - b.x);
    expect(runs.map((o) => [o.k, (o as { s: string }).s, o.x])).toEqual([
      ["cjk", "我要", 16], ["txt", " size M ", 16 + 2 * 48], ["cjk", "黑色", 16 + 2 * 48 + 8 * 32],
    ]);
  });
  it("never below the label bottom (4-dot margin); line steps are 38 (Latin) / 32 (CJK)", () => {
    for (const [w, h] of SIZES) for (const s of [LATIN_SAMPLE, CJK_SAMPLE]) for (const qr of [false, true]) {
      const lines = commentOps(opsOf(payload(s + " " + s + " " + s, { qr }), w, h).ops);
      for (const o of lines) expect(o.y + cellH(o)).toBeLessThanOrEqual(h * 8 - V2_BOTTOM_MARGIN);
      const steps = lines.slice(1).map((o, i) => o.y - lines[i].y);
      expect(steps.every((d) => d === 0 || d === 54)).toBe(true); // 48×pm + 6 (runs on one line share y)
    }
  });
  it("QR: same size/position; only rows meeting the QR (incl. keep-out) stop left of it, rows above use full width", () => {
    for (const [w, h] of SIZES.filter(([, hh]) => hh > 40)) {
      const long = LATIN_SAMPLE + " " + LATIN_SAMPLE;
      const { ops, qr } = opsOf(payload(long, { qr: true }), w, h);
      expect(qr).toEqual(stickerQrPlacement(payload(long, { qr: true, v2: false }), STICKER_LAYOUTS[`${w}x${h}`].wDots, h * 8, h));
      for (const o of commentOps(ops)) {
        const meets = o.y + cellH(o) > qr!.y0 - QR_TEXT_KEEPOUT_GAP;
        if (meets) expect(o.x + cellW(o)).toBeLessThanOrEqual(qr!.x0 - QR_TEXT_KEEPOUT_GAP);
      }
    }
    // shop name off → the comment starts higher, so a row sits fully above the QR and must use the full width
    const { ops, qr } = opsOf(payload(LATIN_SAMPLE + " " + LATIN_SAMPLE, { qr: true, store: "" }), 80, 60);
    const above = commentOps(ops).filter((o) => o.y + cellH(o) <= qr!.y0 - QR_TEXT_KEEPOUT_GAP);
    expect(above.length).toBeGreaterThan(0);
    expect(above.some((o) => o.x + cellW(o) > qr!.x0)).toBe(true); // a row above the QR really uses the full width
  });
  it("Total (when a size shows it): comment rows stop above it", () => {
    const p = payload(LATIN_SAMPLE + " " + LATIN_SAMPLE, { total: true });
    const { ops } = opsOf(p, 80, 60);
    const total = ops.find((o) => o.k === "txt" && o.s === "Total:")!;
    for (const o of commentOps(ops).filter((x) => !(x.k === "txt" && (x.s === "Total:" || x.s.startsWith("NT$"))))) expect(o.y + cellH(o)).toBeLessThanOrEqual(total.y - V2_BOTTOM_MARGIN);
  });
  it("time slot taken (shop name off → Buyer # sits there) → time stays inline before the first comment line", () => {
    const { ops } = opsOf(payload(LATIN_SAMPLE, { store: "" }), 80, 50);
    expect(ops.some((o) => o.k === "txt" && o.x === V2_TIME_X && o.y === V2_TIME_Y)).toBe(false);
    const time = ops.find((o) => o.k === "txt" && o.s === "14:05")!;
    const first = commentOps(ops).find((o) => !(o.k === "txt" && o.s === "14:05"))!;
    expect(time.x).toBe(16);
    expect(first.y).toBe(time.y);
    expect(first.x).toBe(16 + (5 + 2) * 12);
  });
});

describe("wrapCommentV2", () => {
  it("measures per-char widths (CJK 48 / Latin 32), collapses whitespace, never starts a line with a space, hard-splits long words, cuts at maxLines", () => {
    expect(wrapCommentV2("ako   si  jeff", () => 1000, 5, charW)).toEqual(["ako si jeff"]);
    expect(wrapCommentV2("ako si jeff pa", () => 7 * 32, 5, charW)).toEqual(["ako si", "jeff pa"]);
    expect(wrapCommentV2("abcdefghij kl", () => 4 * 32, 5, charW)).toEqual(["abcd", "efgh", "ij", "kl"]);
    expect(wrapCommentV2("我要這件黑色", () => 4 * 48, 5, charW)).toEqual(["我要這件", "黑色"]);
    expect(wrapCommentV2("我要 size M", () => 2 * 48 + 5 * 32, 5, charW)).toEqual(["我要 size", "M"]);
    expect(wrapCommentV2("one two three four", () => 5 * 32, 2, charW)).toEqual(["one", "two"]);
    expect(wrapCommentV2("ab cd", () => 3 * 32, 5, charW)).toEqual(["ab", "cd"]); // "cd" never gets the leading space
  });
});

// ── 4. router gate ───────────────────────────────────────────────────────────
type W = { SellerFlowPrinter?: unknown };
describe("router: the flag reaches the raster only when allowed", () => {
  afterEach(() => { delete (window as W).SellerFlowPrinter; setStickerLayoutV2Allowed(false); });
  const longBuyer = () => ({ handle: "maria_live", name: "Maria Santos", platform: "TikTok", num: 12, totalSpent: 350, totalOrders: 1,
    orders: [{ orderNum: 1, item: LATIN_SAMPLE, qty: 1, price: 350, total: 350, time: "14:05", handle: "maria_live", name: "Maria Santos", bNum: 12, platform: "TikTok", status: "New", date: "2026-09-30" }] }) as never;
  const sent = async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    await printStickerBtRouted(longBuyer(), "NT$", "S", { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "80x50" });
    return (bitmap.mock.calls[0][0] as { data: string }).data;
  };
  const expected = (v2: boolean) => {
    const np = buildNativeStickerPayload(longBuyer(), "NT$", "S", { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "80x50" });
    const rp = { ...np, settings: { ...np.settings, printStickerQr: stickerQrEffective(), ...(v2 ? { printCommentFullWidth: true } : {}) } };
    return Buffer.from(rasterizeToSdkBitmapTspl(rp as RasterPayload, 80, 50, { latin: LATIN_ATLAS }).bytes).toString("base64");
  };
  it("public switch is OFF; not allowed → today's image; allowed (admin) → the v2 image", async () => {
    expect(STICKER_LAYOUT_V2_PUBLIC).toBe(false);
    expect(stickerLayoutV2Effective()).toBe(false);
    expect(await sent()).toBe(expected(false));
    setStickerLayoutV2Allowed(true);
    expect(await sent()).toBe(expected(true));
    expect(expected(true)).not.toBe(expected(false));
  });
});

// ── PNG previews (only when V2_PNG_DIR is set) ───────────────────────────────
function png(r: FullRaster, z: number): Buffer {
  const W = r.w * z, H = r.h * z, row = W * 3 + 1, raw = Buffer.alloc(row * H, 255);
  for (let y = 0; y < H; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < W; x++) if (r.buf[Math.floor(y / z) * r.rowBytes + (Math.floor(x / z) >> 3)] & (0x80 >> (Math.floor(x / z) & 7))) raw.fill(0, y * row + 1 + x * 3, y * row + 4 + x * 3);
  }
  const crc = (b: Buffer) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function writePreviews(dir: string) {
  mkdirSync(dir, { recursive: true });
  const rows: string[] = [];
  for (const f of fixtures()) {
    const today = renderStickerBitmap(payload(f.item, { qr: f.qr, v2: false }), f.w, f.h, AT);
    const v2 = renderStickerBitmap(payload(f.item, { qr: f.qr }), f.w, f.h, AT);
    writeFileSync(join(dir, `${f.key}_today.png`), png(today, 2));
    writeFileSync(join(dir, `${f.key}.png`), png(v2, 2));
    rows.push(`<tr><td>${f.key}</td><td><img src="${f.key}_today.png"></td><td><img src="${f.key}.png"></td></tr>`);
  }
  writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Sticker layout v2</title><style>body{font:13px system-ui;margin:16px}img{border:1px solid #999;image-rendering:pixelated}td{padding:6px;vertical-align:top}</style><h1>LIVE sticker: today vs layout v2 (2× zoom, real atlases)</h1><table><tr><th>Fixture</th><th>Today</th><th>New layout</th></tr>${rows.join("")}</table>`);
}
