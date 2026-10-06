// FACEBOOK NAME ONLY — print side. A Facebook buyer's handle IS the display name, so the
// "@name" line is dropped on every print path; on the phone (bitmap) label the name gets
// HALF-letter word gaps and, when too long, continues on the freed line at the same size.
// Facebook is decided by PLATFORM only. TikTok output is pinned BYTE-IDENTICAL to main
// (hashes captured on origin/main 711bc20 with the clock pinned — not derived from this code).
// Guards: no-name Facebook ("Unknown", handle = id) and username-line-off → today's output.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rasterCalls = vi.hoisted(() => [] as { settings?: Record<string, unknown>; buyer?: { name?: string } }[]);
vi.mock("../stickerRaster", async (importOriginal) => {
  const m = await importOriginal<typeof import("../stickerRaster")>();
  return { ...m, rasterizeToSdkBitmapTspl: (...a: Parameters<typeof m.rasterizeToSdkBitmapTspl>) => { rasterCalls.push(a[0] as never); return m.rasterizeToSdkBitmapTspl(...a); } };
});

import { fbNameOnly, isFacebookPlatform } from "../fbName";
import { fbNameLines, lowestOpBottom, stickerDrawOps, STICKER_LAYOUTS, type DrawOp, type RasterPayload } from "../stickerRaster";
import { printSlip, setStickerQrOn, setStickerQrEntitled, LS_CLASSIC_TEXT, DEF_SETTINGS, __resetWebPrintQueue, __resetNativePrintQueue, type Settings } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
});

const FB = "Caren Kay Ragasa Chao";
const ID = "1029384756473829";
const SIZES: [number, number][] = [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]];

describe("fbNameOnly — the one rule", () => {
  it("Facebook (any case) with a real name → name only", () => {
    for (const p of ["Facebook", "facebook", " FACEBOOK "]) expect(fbNameOnly(p, FB)).toBe(true);
  });
  it("decided by PLATFORM only: TikTok / Shopee / none → never, even when name equals handle", () => {
    for (const p of ["TikTok", "Shopee", "", undefined, null]) expect(fbNameOnly(p, FB)).toBe(false);
    expect(isFacebookPlatform("TikTok")).toBe(false);
  });
  it("guard: no name (server 'Unknown') or blank → today's output", () => {
    expect(fbNameOnly("Facebook", "Unknown")).toBe(false);
    expect(fbNameOnly("Facebook", " Unknown ")).toBe(false);
    expect(fbNameOnly("Facebook", "")).toBe(false);
    expect(fbNameOnly("Facebook", undefined)).toBe(false);
  });
});

describe("fbNameLines — half-gap word layout", () => {
  it("one line when it fits; greedy wrap; ≤ maxLines", () => {
    expect(fbNameLines(FB, 24, 12, 768, 2)).toEqual([["Caren", "Kay", "Ragasa", "Chao"]]);
    expect(fbNameLines(FB, 24, 12, 448, 2)).toEqual([["Caren", "Kay", "Ragasa"], ["Chao"]]);
  });
  it("a word longer than a whole line is broken by letters", () => {
    const w = "Supercalifragilisticexpialidocious"; // 34 letters, 18 fit on 448 dots
    expect(fbNameLines(w, 24, 12, 448, 2)).toEqual([[w.slice(0, 18)], [w.slice(18)]]);
  });
  it("on the LAST line a word that does not fit is cut at the edge", () => {
    expect(fbNameLines("Maria Cristina Dela Cruz Villanueva Santos", 24, 12, 448, 2))
      .toEqual([["Maria", "Cristina", "Dela"], ["Cruz", "Villanueva", "San"]]);
  });
});

// ── the phone (bitmap) label layout ─────────────────────────────────────────
const payloadFor = (name: string, scale: number, fbFlag: boolean, v2 = true): RasterPayload => ({
  storeName: "My Shop", sessionDate: "10/06/2026", currency: "NT$",
  buyer: { num: 7, name, handle: name, totalSpent: 320, orders: [{ time: "21:41", item: "A01" }] },
  settings: {
    printStoreName: true, printBuyerNumber: true, printOrderItems: true, printTotal: false,
    printBuyerUsername: !fbFlag, printBuyerNameScale: scale,
    ...(v2 ? { printCommentFullWidth: true } : {}), ...(fbFlag ? { printFacebookName: true } : {}),
  },
});
type NameOp = Extract<DrawOp, { k: "txt" } | { k: "cjk" }>;
// the name pieces = ops whose text is part of the name, below the "Buyer N" row
const nameOps = (ops: DrawOp[], name: string): NameOp[] => {
  const buyerY = (ops.find((o) => o.k === "txt" && o.s === "Buyer") as NameOp).y;
  return ops.filter((o): o is NameOp => (o.k === "txt" || o.k === "cjk") && o.y > buyerY && o.s !== "" && name.includes(o.s));
};
const linesOf = (ops: NameOp[]) => {
  const ys = [...new Set(ops.map((o) => o.y))].sort((a, b) => a - b);
  return ys.map((y) => ops.filter((o) => o.y === y).sort((a, b) => a.x - b.x).map((o) => o.s));
};

// ── bottom edge: a 2nd name line must never push anything past the label's bottom ───────────
// Matrix: 5 sizes × name 1/2/3× × comment 1/2× × layout v2 on/off × Total on/off × 7 names ×
// 4 comments × 1–2 orders = 6,720 labels. Each Facebook label either fits (lowest op bottom ≤
// hDots) or uses ONE name line (the one-line fallback).
const M_NAMES = [FB, "Joy M", "陳小美的店很好很好很好好", "Maria Cristina Dela Cruz Villanueva Santos",
  "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Nguyễn Thị Minh Khai", "李美玲 Lily Chen"];
const M_COMMENTS = ["Mine", "A01", "D2 red dress size M", "藍色外套 2件"];
type MCase = { w: number; h: number; scale: number; cs: number; v2: boolean; total: boolean; name: string; comment: string; n: number };
const mPayload = (m: MCase): RasterPayload => ({
  storeName: "My Shop", sessionDate: "10/06/2026", currency: "NT$",
  buyer: { num: 7, name: m.name, handle: m.name, totalSpent: 640,
    orders: Array.from({ length: m.n }, (_, i) => ({ time: i ? "21:42" : "21:41", item: m.comment })) },
  settings: {
    printStoreName: true, printBuyerNumber: true, printOrderItems: true, printTotal: m.total,
    printBuyerUsername: false, printBuyerNameScale: m.scale, printCommentScale: m.cs,
    ...(m.v2 ? { printCommentFullWidth: true } : {}), printFacebookName: true,
  },
});
const mNameLines = (ops: DrawOp[], name: string) => {
  const buyerY = (ops.find((o) => o.k === "txt" && o.s === "Buyer") as NameOp).y;
  const items = new Set(M_COMMENTS);
  return new Set(ops.filter((o): o is NameOp => (o.k === "txt" || o.k === "cjk") && o.y > buyerY && o.s !== "" && !items.has(o.s) && name.includes(o.s)).map((o) => o.y)).size;
};
const mCases = (): MCase[] => {
  const out: MCase[] = [];
  for (const [w, h] of SIZES) for (const scale of [1, 2, 3]) for (const cs of [1, 2]) for (const v2 of [true, false])
    for (const total of [false, true]) for (const name of M_NAMES) for (const comment of M_COMMENTS) for (const n of [1, 2])
      out.push({ w, h, scale, cs, v2, total, name, comment, n });
  return out;
};
const mCheck = (m: MCase) => {
  const r = stickerDrawOps(mPayload(m), m.w, m.h);
  return { bottom: lowestOpBottom(r.ops), hDots: r.hDots, lines: mNameLines(r.ops, m.name) };
};

describe("phone label: a 2nd Facebook name line never pushes anything past the bottom edge", () => {
  it("6,720 combinations: lowest op bottom ≤ label height, OR the name uses one line", () => {
    const cases = mCases();
    expect(cases).toHaveLength(6720);
    const bad = cases.map((m) => ({ m, ...mCheck(m) })).filter((x) => x.bottom > x.hDots && x.lines !== 1);
    expect(bad.map((x) => `${x.m.w}x${x.m.h} n${x.m.scale} c${x.m.cs} v2=${x.m.v2} T=${x.m.total} ${x.m.name}|${x.m.comment}|${x.m.n} bottom=${x.bottom}`)).toEqual([]);
  });
  const base = { cs: 1, v2: true, total: false, comment: "Mine" };
  it("review example 1 — 100×60, name 2×, 2 orders, FB name: one line (2 lines would end at 485 > 480)", () => {
    const r = mCheck({ ...base, w: 100, h: 60, scale: 2, name: FB, n: 2 });
    expect(r.lines).toBe(1); expect(r.bottom).toBeLessThanOrEqual(480);
  });
  it("review example 2 — 100×60, name 2×, Total on: one line (2 lines would end at 541)", () => {
    const r = mCheck({ ...base, w: 100, h: 60, scale: 2, name: FB, n: 1, total: true });
    expect(r.lines).toBe(1);
  });
  it("review example 3 — 60×40, name 1×, long Chinese name, 2 orders: one line (2 lines would end at 328 > 320)", () => {
    const r = mCheck({ ...base, w: 60, h: 40, scale: 1, name: "陳小美的店很好很好很好好", n: 2 });
    expect(r.lines).toBe(1); expect(r.bottom).toBeLessThanOrEqual(320);
  });
  it("main case kept: \"Caren Kay Ragasa Chao\" on 60×40 at 1× with comment \"Mine\" still prints on two lines", () => {
    const r = mCheck({ ...base, w: 60, h: 40, scale: 1, name: FB, n: 1 });
    expect(r.lines).toBe(2); expect(r.bottom).toBeLessThanOrEqual(r.hDots);
  });
});

describe("phone label: Facebook name only — all 5 sizes, name scale 1× and 2×", () => {
  for (const [w, h] of SIZES) for (const scale of [1, 2]) {
    it(`${w}×${h} at ${scale}×: no "@" line, half-letter gaps, ≤ 2 lines inside the margins, comment still printed`, () => {
      const { ops } = stickerDrawOps(payloadFor(FB, scale, true), w, h);
      const c = STICKER_LAYOUTS[`${w}x${h}`];
      expect(ops.some((o) => (o.k === "txt" || o.k === "cjk") && o.s.startsWith("@"))).toBe(false);
      const nops = nameOps(ops, FB);
      const lines = linesOf(nops);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(2);
      const cell = 24 * scale;
      for (const o of nops) expect(o.x + [...o.s].length * cell).toBeLessThanOrEqual(c.rightEdge);
      const ys = [...new Set(nops.map((o) => o.y))].sort((a, b) => a - b);
      for (const y of ys) {
        const row = nops.filter((o) => o.y === y).sort((a, b) => a.x - b.x);
        expect(row[0].x).toBe(16);
        for (let i = 1; i < row.length; i++) expect(row[i].x).toBe(row[i - 1].x + [...row[i - 1].s].length * cell + cell / 2);
      }
      expect(lines.flat().join(" ")).toBe(FB.slice(0, lines.flat().join(" ").length)); // in order, cut only at the end
      expect(ops.some((o) => o.k === "txt" && o.s === "A01")).toBe(true);
    });
  }
  it("the owner's example lines", () => {
    const L = (w: number, h: number, s: number) => linesOf(nameOps(stickerDrawOps(payloadFor(FB, s, true), w, h).ops, FB));
    expect(L(100, 60, 1)).toEqual([["Caren", "Kay", "Ragasa", "Chao"]]);
    expect(L(70, 50, 1)).toEqual([["Caren", "Kay", "Ragasa", "Chao"]]);
    expect(L(60, 40, 1)).toEqual([["Caren", "Kay", "Ragasa"], ["Chao"]]);
    expect(L(100, 60, 2)).toEqual([["Caren", "Kay", "Ragasa"], ["Chao"]]);
    // 60×40 at 2×: a 2nd name line (66 dots) would push the price code off the label → one line
    expect(L(60, 40, 2)).toEqual([["Caren", "Kay"]]);
  });
  it("the 2nd line is used ONLY when everything else prints exactly as with one line (price code never lost)", () => {
    for (const [w, h] of SIZES) for (const scale of [1, 2, 3]) for (const v2 of [true, false]) {
      const ops = stickerDrawOps(payloadFor(FB, scale, true, v2), w, h).ops;
      const rest = (os: DrawOp[]) => os.flatMap((o) => (o.k === "txt" || o.k === "cjk") && !FB.includes(o.s) ? [o.s] : []);
      // the price code / time present whenever today's layout (with the @ line) prints them
      const today = stickerDrawOps(payloadFor(FB, scale, false, v2), w, h).ops;
      for (const s of rest(today).filter((x) => x === "A01" || x === "21:41")) expect(rest(ops), `${w}x${h} ${scale}x v2=${v2} ${s}`).toContain(s);
    }
  });
  it("the 2nd line sits one name line below the 1st, at the same size", () => {
    const nops = nameOps(stickerDrawOps(payloadFor(FB, 1, true), 60, 40).ops, FB);
    const ys = [...new Set(nops.map((o) => o.y))].sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBe(STICKER_LAYOUTS["60x40"].nameGap);
    expect(new Set(nops.map((o) => (o as Extract<DrawOp, { k: "txt" }>).xm)).size).toBe(1);
  });
  it("a Chinese name continues on the 2nd line by characters (no word gaps)", () => {
    const zh = "陳小美的店很好很好很好好";
    const ops = stickerDrawOps(payloadFor(zh, 1, true), 60, 40).ops.filter((o): o is Extract<DrawOp, { k: "cjk" }> => o.k === "cjk");
    expect(ops.map((o) => o.s)).toEqual(["陳小美的店很好很好", "很好好"]);
    expect(stickerDrawOps(payloadFor(zh, 1, true), 100, 60).ops.filter((o) => o.k === "cjk").map((o) => (o as { s: string }).s)).toEqual([zh]);
  });
  it("a single word longer than one line is broken by letters", () => {
    const w = "Supercalifragilisticexpialidocious";
    expect(linesOf(nameOps(stickerDrawOps(payloadFor(w, 1, true), 60, 40).ops, w))).toEqual([[w.slice(0, 18)], [w.slice(18)]]);
  });
  it("a very long name: 2 lines, the rest cut at the edge", () => {
    const n = "Maria Cristina Dela Cruz Villanueva Santos";
    expect(linesOf(nameOps(stickerDrawOps(payloadFor(n, 1, true), 60, 40).ops, n)))
      .toEqual([["Maria", "Cristina", "Dela"], ["Cruz", "Villanueva", "San"]]);
  });
  it("without the flag (TikTok, or the legacy text mirror) the name is ONE op and the @ line prints", () => {
    const { ops } = stickerDrawOps(payloadFor(FB, 1, false), 60, 40);
    expect(ops.some((o) => o.k === "txt" && o.s === `@${FB}`)).toBe(true);
    expect(ops.some((o) => o.k === "txt" && o.s === FB)).toBe(true);
    // the flag never applies in the legacy (text-TSPL mirror) mode
    const legacy = stickerDrawOps(payloadFor(FB, 1, true), 60, 40, "legacy").ops;
    expect(legacy.some((o) => o.k === "txt" && o.s === FB)).toBe(true);
  });
});

// ── printSlip routing (every print path) ────────────────────────────────────
type W = { SellerFlowPrinter?: unknown };
const mk = (platform: string, name: string, handle: string): Buyer => ({ handle, name, platform, num: 7, orders: [{ orderNum: 1750000000000, item: "A01", qty: 1, price: 320, total: 320, time: "9:41 PM", handle, name, bNum: 7, platform, status: "New", date: "2026-10-06" }], totalOrders: 1, totalSpent: 320 } as unknown as Buyer);
async function viaBridge(b: Buyer, cfg: Settings, bridge: Record<string, ReturnType<typeof vi.fn>>, key: string) {
  __resetNativePrintQueue();
  (window as W).SellerFlowPrinter = bridge;
  printSlip(b, "NT$", "My Shop", cfg);
  await vi.waitFor(() => expect(bridge[key].mock.calls.length).toBe(1));
  delete (window as W).SellerFlowPrinter;
  return bridge[key].mock.calls[0][0] as { settings: Record<string, unknown>; buyer: { name: string; handle: string } };
}
const bitmapBridge = () => ({ printStickerNative: vi.fn().mockResolvedValue({ ok: true }), printStickerBitmap: vi.fn().mockResolvedValue({ ok: true }) });
const textBridge = () => ({ printStickerNative: vi.fn().mockResolvedValue({ ok: true }) });
const lanBridge = () => ({ printStickerLan: vi.fn().mockResolvedValue({ ok: true }) });
const slipBridge = () => ({ printSlip: vi.fn().mockResolvedValue({ ok: true }) });
const bt: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "60x40" };
const lan: Settings = { ...bt, printerType: "lan", lanFormat: "sticker" };
const slip: Settings = { ...DEF_SETTINGS, printerType: "lan", lanFormat: "receipt" };
async function rasterSettingsFor(b: Buyer, cfg: Settings) {
  rasterCalls.length = 0;
  await viaBridge(b, cfg, bitmapBridge(), "printStickerBitmap");
  return rasterCalls[0].settings!;
}

describe("printSlip: Facebook drops the @ line on every path; TikTok untouched", () => {
  beforeEach(() => { localStorage.removeItem(LS_CLASSIC_TEXT); setStickerQrEntitled(true); setStickerQrOn(false); });
  afterEach(() => { setStickerQrEntitled(false); });
  it("phone bitmap: Facebook → name-only flag + no @ line; TikTok → neither", async () => {
    const fb = await rasterSettingsFor(mk("Facebook", FB, FB), bt);
    expect(fb.printFacebookName).toBe(true);
    expect(fb.printBuyerUsername).toBe(false);
    const tt = await rasterSettingsFor(mk("TikTok", FB, FB), bt);
    expect("printFacebookName" in tt).toBe(false);
    expect(tt.printBuyerUsername).toBe(true);
  });
  it("text fallback, WiFi/LAN sticker and slip: Facebook → printBuyerUsername false (name kept); TikTok → true", async () => {
    for (const [cfg, mkBridge, key] of [[bt, textBridge, "printStickerNative"], [lan, lanBridge, "printStickerLan"], [slip, slipBridge, "printSlip"]] as const) {
      const fb = await viaBridge(mk("Facebook", FB, FB), cfg, mkBridge(), key);
      expect(fb.settings.printBuyerUsername, key).toBe(false);
      expect(fb.buyer.name, key).toBe(FB);
      const tt = await viaBridge(mk("TikTok", FB, FB), cfg, mkBridge(), key);
      expect(tt.settings.printBuyerUsername, key).toBe(true);
    }
  });
  it("rule 5: username line already OFF → no flag (nothing changes for that seller)", async () => {
    const s = await rasterSettingsFor(mk("Facebook", FB, FB), { ...bt, printBuyerUsername: false });
    expect("printFacebookName" in s).toBe(false);
  });
  it("rule 3 guard: Facebook with no name ('Unknown', handle = id) → today's output on every path", async () => {
    const b = mk("Facebook", "Unknown", ID);
    expect("printFacebookName" in (await rasterSettingsFor(b, bt))).toBe(false);
    for (const [cfg, mkBridge, key] of [[bt, textBridge, "printStickerNative"], [lan, lanBridge, "printStickerLan"], [slip, slipBridge, "printSlip"]] as const) {
      expect((await viaBridge(b, cfg, mkBridge(), key)).settings.printBuyerUsername, key).toBe(true);
    }
  });
  it("rule 4: the 'buyer name' toggle OFF never hides the name — the Facebook label still prints it once", async () => {
    rasterCalls.length = 0;
    await viaBridge(mk("Facebook", FB, FB), { ...bt, printBuyerName: false }, bitmapBridge(), "printStickerBitmap");
    const p = rasterCalls[0] as unknown as RasterPayload;
    expect(p.settings?.printFacebookName).toBe(true);
    const nops = nameOps(stickerDrawOps(p, 60, 40).ops, FB);
    expect(linesOf(nops).flat().join(" ")).toBe(FB);
  });
});

describe("web/laptop print", () => {
  let frame: HTMLIFrameElement | null = null;
  beforeEach(() => {
    __resetWebPrintQueue(); setStickerQrOn(false);
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
  });
  afterEach(() => { vi.restoreAllMocks(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });
  const html = (b: Buyer, cfg: Settings = { ...DEF_SETTINGS }) => { printSlip(b, "NT$", "My Shop", cfg); return frame?.contentDocument?.documentElement.outerHTML || ""; };
  it("Facebook: no @ line; the name may take 2 lines (no '…' cut)", () => {
    const out = html(mk("Facebook", FB, FB));
    expect(out).not.toContain('class="user"');
    expect(out).toContain(`<div class="name fbname">${FB}</div>`);
    expect(out).toContain("-webkit-line-clamp:2");
  });
  it("TikTok: the @ line stays, no Facebook CSS", () => {
    const out = html(mk("TikTok", "Joy M", "kaldag_queenpocket_oo"));
    expect(out).toContain('<div class="user">@kaldag_queenpocket_oo</div>');
    expect(out).not.toContain("fbname");
  });
  it("Facebook 'Unknown' and username-off keep today's page", () => {
    expect(html(mk("Facebook", "Unknown", ID))).toContain(`<div class="user">@${ID}</div>`);
    const off = html(mk("Facebook", FB, FB), { ...DEF_SETTINGS, printBuyerUsername: false });
    expect(off).not.toContain("fbname");
  });
});

// ── TikTok byte-identical to main on every print path ───────────────────────
// sha256 (first 16 hex) captured on origin/main 711bc20, clock pinned to 2026-10-06T04:00Z.
const MAIN = {
  "tt.bitmap.60x40": "9f883b9e6d084b92", "tt.text.60x40": "9d0098f7f201e803", "tt.lan.60x40": "9d0098f7f201e803",
  "tt.bitmap.100x60": "c075d0d1c03717e5", "tt.text.100x60": "2cbeb8b0ae2b0493", "tt.lan.100x60": "2cbeb8b0ae2b0493",
  "tt.slip": "f1475d670fae6c07", "tt.web": "978a7b9c9c94435a",
  "ttSame.bitmap.60x40": "4b90980d555e4239", "ttSame.text.60x40": "01fe8c0cfe96af20", "ttSame.lan.60x40": "01fe8c0cfe96af20",
  "ttSame.bitmap.100x60": "d029b5c39c6eb89e", "ttSame.text.100x60": "befa95083c11e399", "ttSame.lan.100x60": "befa95083c11e399",
  "ttSame.slip": "2bf7d480b1459997", "ttSame.web": "3584f16d41138639",
} as const;
const sha16 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);

describe("TikTok output is byte-identical to main (phone label, text, WiFi, slip, web)", () => {
  it("both a normal TikTok buyer and one whose nickname equals the username", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T04:00:00Z"), toFake: ["Date"] });
    try {
      localStorage.removeItem(LS_CLASSIC_TEXT); setStickerQrEntitled(true); setStickerQrOn(false);
      const got: Record<string, string> = {};
      const buyers = { tt: mk("TikTok", "Joy M", "kaldag_queenpocket_oo"), ttSame: mk("TikTok", FB, FB) };
      for (const [k, b] of Object.entries(buyers)) {
        for (const size of ["60x40", "100x60"]) {
          const c: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: size };
          const call = async (cfg: Settings, br: Record<string, ReturnType<typeof vi.fn>>, key: string) => {
            __resetNativePrintQueue(); (window as W).SellerFlowPrinter = br;
            printSlip(b, "NT$", "My Shop", cfg);
            await vi.waitFor(() => expect(br[key].mock.calls.length).toBe(1));
            delete (window as W).SellerFlowPrinter;
            return sha16(JSON.stringify(br[key].mock.calls[0][0]));
          };
          got[`${k}.bitmap.${size}`] = await call(c, bitmapBridge(), "printStickerBitmap");
          got[`${k}.text.${size}`] = await call(c, textBridge(), "printStickerNative");
          got[`${k}.lan.${size}`] = await call({ ...c, printerType: "lan", lanFormat: "sticker" }, lanBridge(), "printStickerLan");
        }
        __resetNativePrintQueue(); const sb = slipBridge(); (window as W).SellerFlowPrinter = sb;
        printSlip(b, "NT$", "My Shop", slip);
        await vi.waitFor(() => expect(sb.printSlip.mock.calls.length).toBe(1));
        delete (window as W).SellerFlowPrinter;
        got[`${k}.slip`] = await sha16(JSON.stringify(sb.printSlip.mock.calls[0][0]));
        __resetWebPrintQueue();
        let frame: HTMLIFrameElement | null = null;
        const orig = document.createElement.bind(document);
        const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
        printSlip(b, "NT$", "My Shop", { ...DEF_SETTINGS });
        got[`${k}.web`] = await sha16((frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML || "");
        spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
      }
      expect(got).toEqual(MAIN);
    } finally { vi.useRealTimers(); setStickerQrEntitled(false); }
  });
});
