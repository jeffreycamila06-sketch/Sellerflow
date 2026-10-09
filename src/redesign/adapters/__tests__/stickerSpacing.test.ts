// STICKER SPACING — half-letter word gaps (printHalfWordGap) + Compact vertical gaps
// (printSpacing "compact"), bitmap/extended only. Rules R1–R4; switch/allowlist routing;
// the Facebook bottom-edge matrix re-run with Compact; the Live print pattern fit warning.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rasterCalls = vi.hoisted(() => [] as { settings?: Record<string, unknown> }[]);
vi.mock("../stickerRaster", async (importOriginal) => {
  const m = await importOriginal<typeof import("../stickerRaster")>();
  return { ...m, rasterizeToSdkBitmapTspl: (...a: Parameters<typeof m.rasterizeToSdkBitmapTspl>) => { rasterCalls.push(a[0] as never); return m.rasterizeToSdkBitmapTspl(...a); } };
});

import { stickerDrawOps, lowestOpBottom, STICKER_LAYOUTS, COMPACT_GAPS, V2_BOTTOM_MARGIN, type DrawOp, type RasterPayload, type RasterSettings } from "../stickerRaster";
import {
  printSlip, setStickerQrOn, setStickerQrEntitled, LS_CLASSIC_TEXT, DEF_SETTINGS, __resetNativePrintQueue, buildNativeStickerPayload,
  stickerSpacingAllowed, setStickerSpacingAllowed, setStickerSpacingChoice, stickerSpacingFlags, spacingFlagsFor, STICKER_SPACING_PUBLIC,
  buildSettingsFromRedesign, type Settings,
} from "../printing";
import { stickerFit, FIT_SAMPLE_NAME, FIT_SAMPLE_COMMENT } from "../stickerFit";
import type { Buyer } from "../../../lib/orderTypes";
import { setFeatureAccess } from "../featureAccess";
import { seedEmails } from "./featureSeed";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
});

const SIZES: [number, number][] = [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]];
const NAME = "Cristine Ramos Cabañas";
const C = "Mine black size XL 2pcs 350";
const pay = (extra: RasterSettings, o: { name?: string; handle?: string; ns?: number; cs?: number; v2?: boolean; orders?: number } = {}): RasterPayload => ({
  storeName: "My Shop", sessionDate: "10/07/2026", currency: "NT$",
  buyer: { num: 12, name: o.name ?? NAME, handle: o.handle ?? "cristineramos", totalSpent: 350,
    orders: [{ time: "21:41", item: C }, { time: "21:42", item: "A01" }].slice(0, o.orders ?? 1) },
  settings: { printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printTotal: false,
    printBuyerNameScale: o.ns ?? 1, printCommentScale: o.cs ?? 1, ...(o.v2 === false ? {} : { printCommentFullWidth: true }), ...extra },
});
type T = Extract<DrawOp, { k: "txt" }>;
const txt = (ops: DrawOp[]) => ops.filter((x): x is T => x.k === "txt");
const HALF: RasterSettings = { printHalfWordGap: true };
const COMPACT: RasterSettings = { printSpacing: "compact" };

describe("R1 — Compact gaps", () => {
  for (const [w, h] of SIZES) it(`${w}x${h}: the row steps use the compact table (only the 4 gap keys change)`, () => {
    const c = { ...STICKER_LAYOUTS[`${w}x${h}`], ...(COMPACT_GAPS[`${w}x${h}`] ?? {}) };
    const ops = txt(stickerDrawOps(pay(COMPACT), w, h).ops);
    const buyerY = ops.find((o) => o.s === "Buyer")!.y;
    const nameY = ops.find((o) => o.s === NAME)!.y;
    const userY = ops.find((o) => o.s === "@cristineramos")!.y;
    const sep = stickerDrawOps(pay(COMPACT), w, h).ops.find((o) => o.k === "bar" && o.x === 16)!;
    expect([buyerY - 60, nameY - buyerY, userY - nameY, sep.y - userY]).toEqual([c.storeGap, c.buyerNumGap, c.nameGap, c.usernameGap]);
  });
  it("the exact compact values (60x40 unchanged)", () => {
    expect(COMPACT_GAPS).toEqual({
      "100x60": { storeGap: 33, buyerNumGap: 80, nameGap: 44, usernameGap: 40 },
      "80x60": { storeGap: 29, buyerNumGap: 80 }, "80x50": { storeGap: 29, buyerNumGap: 80 }, "70x50": { storeGap: 29, buyerNumGap: 80 },
    });
    expect(stickerDrawOps(pay(COMPACT), 60, 40)).toEqual(stickerDrawOps(pay({}), 60, 40));
  });
  it("the legacy text mirror ignores both flags", () => {
    for (const [w, h] of SIZES) expect(stickerDrawOps(pay({ ...COMPACT, ...HALF }), w, h, "legacy")).toEqual(stickerDrawOps(pay({}), w, h, "legacy"));
  });
  it("the Facebook name uses the compact name/username gaps", () => {
    const LONG = "Maria Cristina Dela Cruz Villanueva Santos";
    const fb = (s: RasterSettings) => stickerDrawOps(pay({ printFacebookName: true, printBuyerUsername: false, ...s }, { name: LONG, handle: LONG }), 80, 60).ops;
    const ys = (ops: DrawOp[]) => [...new Set(txt(ops).filter((o) => LONG.includes(o.s) && o.font === "4" && o.s !== "Buyer" && o.y > 100).map((o) => o.y))];
    const c = ys(fb(COMPACT)), n = ys(fb({}));
    expect(c).toHaveLength(2); expect(n).toHaveLength(2);
    expect(c[0]).toBe(n[0] - (95 - 80) - (35 - 29));
    expect(c[1] - c[0]).toBe(STICKER_LAYOUTS["80x60"].nameGap);
  });
});

describe("R2 — non-Facebook name with half-letter gaps", () => {
  it("each word is its own font-4 op from x=16, advancing letters×cell + cell/2", () => {
    for (const ns of [1, 2]) {
      const cell = 24 * ns;
      const ops = txt(stickerDrawOps(pay(HALF, { ns }), 100, 60).ops).filter((o) => o.font === "4" && o.xm === ns && o.y > 150 && o.y < 300);
      const words = ns === 1 ? ["Cristine", "Ramos", "Cabañas"] : ["Cristine", "Ramos", "Ca"];
      expect(ops.map((o) => o.s)).toEqual(words);
      let x = 16;
      for (const o of ops) { expect(o.x).toBe(x); expect(o.ym).toBe(ns); x += [...o.s].length * cell + cell / 2; }
    }
  });
  it("one line only, a word that does not fit is cut at a whole letter inside the margin", () => {
    const ops = txt(stickerDrawOps(pay(HALF), 60, 40).ops).filter((o) => o.font === "4" && o.y > 100 && o.y < 160);
    expect(ops.map((o) => o.s)).toEqual(["Cristine", "Ramos", "Caba"]);
    expect(Math.max(...ops.map((o) => o.x + [...o.s].length * 24))).toBeLessThanOrEqual(STICKER_LAYOUTS["60x40"].rightEdge);
  });
  it("a Chinese name is unchanged (textSmart as today)", () => {
    for (const [w, h] of SIZES) {
      const a = stickerDrawOps(pay(HALF, { name: "陳小美的店" }), w, h).ops.filter((o) => o.k === "cjk" && o.s.startsWith("陳"));
      const b = stickerDrawOps(pay({}, { name: "陳小美的店" }), w, h).ops.filter((o) => o.k === "cjk" && o.s.startsWith("陳"));
      expect(a).toEqual(b);
    }
  });
});

describe("R3 — v2 comment with half-letter gaps", () => {
  const commentOps = (ops: DrawOp[], m: number) => txt(ops).filter((o) => o.font === "3" && o.xm === m);
  it("no space glyph; a space ends the run and advances 8×m", () => {
    const ops = commentOps(stickerDrawOps(pay(HALF), 60, 40).ops, 2);
    expect(ops.map((o) => o.s)).toEqual(["Mine", "black", "size", "XL", "2pcs", "350"]);
    for (const o of ops) expect(o.s).not.toContain(" ");
    const row = ops.filter((o) => o.y === ops[0].y);
    for (let i = 1; i < row.length; i++) expect(row[i].x).toBe(row[i - 1].x + [...row[i - 1].s].length * 32 + 16);
  });
  it("lines per size at comment 1× / 2× (the planned table)", () => {
    const lines = (w: number, h: number, cs: number) => {
      const ops = commentOps(stickerDrawOps(pay(HALF, { cs }), w, h).ops, 2 * cs);
      const ys = [...new Set(ops.map((o) => o.y))].sort((a, b) => a - b);
      return ys.map((y) => ops.filter((o) => o.y === y).map((o) => o.s).join(" "));
    };
    expect(lines(70, 50, 1)).toEqual(["Mine black size XL", "2pcs 350"]);
    expect(lines(60, 40, 1)).toEqual(["Mine black size", "XL 2pcs 350"]);
    expect(lines(80, 60, 2)).toEqual(["Mine black", "size XL"]);
    expect(lines(80, 50, 2)).toEqual(["Mine black"]);
  });
});

describe("R4 — never a zero-line comment", () => {
  for (const [w, h] of SIZES) for (const compact of [false, true]) for (const cs of [1, 2, 3]) {
    it(`${w}x${h} comment ${cs}× ${compact ? "compact" : "normal"}: at least one line, stepped down only when needed`, () => {
      const r = stickerDrawOps(pay({ ...HALF, ...(compact ? COMPACT : {}) }, { cs }), w, h);
      const sep = r.ops.find((o) => o.k === "bar" && o.x === 16)!;
      let pm = cs;
      while (pm > 1 && sep.y + STICKER_LAYOUTS[`${w}x${h}`].sepGap + 48 * pm > h * 8 - V2_BOTTOM_MARGIN) pm--;
      const ops = txt(r.ops).filter((o) => o.font === "3" && o.y > sep.y);
      expect(ops.length).toBeGreaterThan(0);
      expect(new Set(ops.map((o) => o.xm))).toEqual(new Set([2 * pm]));
      expect(lowestOpBottom(r.ops)).toBeLessThanOrEqual(h * 8);
    });
  }
});

describe("two-order rows (Print screen) stay exactly as today", () => {
  it("half gaps do not touch the row path", () => {
    for (const [w, h] of SIZES) {
      const a = txt(stickerDrawOps(pay(HALF, { orders: 2 }), w, h).ops).filter((o) => o.s.startsWith("Mine"));
      const b = txt(stickerDrawOps(pay({}, { orders: 2 }), w, h).ops).filter((o) => o.s.startsWith("Mine"));
      expect(a).toEqual(b);
    }
  });
});

// ── the switch / allowlist / routing ─────────────────────────────────────────
describe("the allowlist (applies when STICKER_SPACING_PUBLIC is false)", () => {
  it("admin role + the two googletest accounts only — not the other sticker-v2 accounts", () => {
    expect(STICKER_SPACING_PUBLIC).toBe(true);
    expect(stickerSpacingAllowed("someone@gmail.com", "seller")).toBe(true);
    expect(stickerSpacingAllowed("x@y.com", "admin", false)).toBe(true);
    // Build 10b: the two googletest accounts live in sql/112 (sticker_spacing); the app sees a yes/no
    expect(seedEmails("sticker_spacing")).toEqual(["googletest@gmail.com", "googletest@sellerflowlive.com"]);
    setFeatureAccess({ sticker_spacing: true });
    expect(stickerSpacingAllowed("googletest@gmail.com", "seller", false)).toBe(true);
    setFeatureAccess(null);
    for (const e of ["googletest@gmail.com", "cristycabanas34@gmail.com", "someone@gmail.com", ""]) expect(stickerSpacingAllowed(e, "seller", false)).toBe(false);
    expect(stickerSpacingAllowed("someone@gmail.com", "seller", true)).toBe(true);
  });
  it("flags: none when not allowed; half gaps always + compact only when chosen", () => {
    expect(spacingFlagsFor(false, "compact")).toEqual({});
    expect(spacingFlagsFor(true, "normal")).toEqual({ printHalfWordGap: true });
    expect(spacingFlagsFor(true, undefined)).toEqual({ printHalfWordGap: true });
    expect(spacingFlagsFor(true, "compact")).toEqual({ printHalfWordGap: true, printSpacing: "compact" });
  });
});

type W = { SellerFlowPrinter?: unknown };
const mk = (platform: string): Buyer => ({ handle: "cristineramos", name: NAME, platform, num: 7, orders: [{ orderNum: 1750000000000, item: C, qty: 1, price: 350, total: 350, time: "9:41 PM", handle: "cristineramos", name: NAME, bNum: 7, platform, status: "New", date: "2026-10-07" }], totalOrders: 1, totalSpent: 350 } as unknown as Buyer);
async function rasterSettingsFor(b: Buyer, cfg: Settings) {
  rasterCalls.length = 0;
  __resetNativePrintQueue();
  const bridge = { printStickerNative: vi.fn().mockResolvedValue({ ok: true }), printStickerBitmap: vi.fn().mockResolvedValue({ ok: true }) };
  (window as W).SellerFlowPrinter = bridge;
  printSlip(b, "NT$", "My Shop", cfg);
  await vi.waitFor(() => expect(bridge.printStickerBitmap.mock.calls.length).toBe(1));
  delete (window as W).SellerFlowPrinter;
  return rasterCalls[0].settings!;
}
const bt: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "60x40" };

describe("routing: the flags reach the image ONLY for an allowed seller", () => {
  beforeEach(() => { localStorage.removeItem(LS_CLASSIC_TEXT); setStickerQrEntitled(true); setStickerQrOn(false); });
  afterEach(() => { setStickerSpacingAllowed(false); setStickerSpacingChoice("normal"); setStickerQrEntitled(false); });
  it("not allowed (default) → neither flag, even with Compact chosen on the device", async () => {
    setStickerSpacingChoice("compact");
    for (const p of ["TikTok", "Facebook", ""]) {
      const s = await rasterSettingsFor(mk(p), bt);
      expect("printHalfWordGap" in s, p).toBe(false);
      expect("printSpacing" in s, p).toBe(false);
    }
    expect(stickerSpacingFlags()).toEqual({});
  });
  it("allowed → half gaps; + compact when chosen (row hidden: compact with no stored choice; row visible: Normal)", async () => {
    setStickerSpacingAllowed(true);
    const n = await rasterSettingsFor(mk("TikTok"), bt);
    expect(n).toMatchObject({ printHalfWordGap: true, printSpacing: "compact" }); // row hidden → STICKER_SPACING_FIXED
    expect(stickerSpacingFlags(true)).toEqual({ printHalfWordGap: true });     // row visible → absent = Normal (as before)
    setStickerSpacingChoice("compact");
    const c = await rasterSettingsFor(mk("Facebook"), bt);
    expect(c).toMatchObject({ printHalfWordGap: true, printSpacing: "compact", printFacebookName: true });
  });
  it("the native payload (text fallback / WiFi sticker) is identical with the switch on", () => {
    setStickerSpacingAllowed(true); setStickerSpacingChoice("compact");
    vi.useFakeTimers({ now: new Date("2026-10-07T04:00:00Z"), toFake: ["Date"] });
    try {
      const on = JSON.stringify(buildNativeStickerPayload(mk("TikTok"), "NT$", "My Shop", bt));
      setStickerSpacingAllowed(false); setStickerSpacingChoice("normal");
      expect(JSON.stringify(buildNativeStickerPayload(mk("TikTok"), "NT$", "My Shop", bt))).toBe(on);
      expect(on).not.toMatch(/printHalfWordGap|printSpacing/);
    } finally { vi.useRealTimers(); }
  });
});

// ── the Facebook bottom-edge matrix, re-run with Compact (+ half gaps, as allowed sellers send) ──
const M_NAMES = ["Caren Kay Ragasa Chao", "Joy M", "陳小美的店很好很好很好好", "Maria Cristina Dela Cruz Villanueva Santos",
  "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Nguyễn Thị Minh Khai", "李美玲 Lily Chen"];
const M_COMMENTS = ["Mine", "A01", "D2 red dress size M", "藍色外套 2件"];
describe("Facebook 2-line name never goes past the bottom — Compact", () => {
  it("6,720 combinations: lowest op bottom ≤ label height, OR the name uses one line", () => {
    let n = 0; const bad: string[] = [];
    for (const [w, h] of SIZES) for (const scale of [1, 2, 3]) for (const cs of [1, 2]) for (const v2 of [true, false])
      for (const total of [false, true]) for (const name of M_NAMES) for (const comment of M_COMMENTS) for (const k of [1, 2]) {
        n++;
        const p: RasterPayload = { storeName: "My Shop", sessionDate: "10/06/2026", currency: "NT$",
          buyer: { num: 7, name, handle: name, totalSpent: 640, orders: Array.from({ length: k }, (_, i) => ({ time: i ? "21:42" : "21:41", item: comment })) },
          settings: { printStoreName: true, printBuyerNumber: true, printOrderItems: true, printTotal: total, printBuyerUsername: false,
            printBuyerNameScale: scale, printCommentScale: cs, ...(v2 ? { printCommentFullWidth: true } : {}), printFacebookName: true, ...HALF, ...COMPACT } };
        const r = stickerDrawOps(p, w, h);
        const buyerY = txt(r.ops).find((o) => o.s === "Buyer")!.y;
        // name pieces = above the separator (half gaps split the comment into words, so a comment
        // word like "M" must not be mistaken for part of a name)
        const sepY = r.ops.find((o) => o.k === "bar" && o.x === 16)?.y ?? Infinity;
        const lines = new Set(r.ops.filter((o) => o.k !== "bar" && o.y > buyerY && o.y < sepY && o.s !== "" && name.includes(o.s)).map((o) => o.y)).size;
        if (lowestOpBottom(r.ops) > r.hDots && lines !== 1) bad.push(`${w}x${h} n${scale} c${cs} v2=${v2} T=${total} ${name}|${comment}|${k}`);
      }
    expect(n).toBe(6720);
    expect(bad.join("\n")).toBe("");
  });
});

// ── the Live print pattern fit warning (layout step only) ─────────────────────
const PP = { shopName: true, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };
const cfgFor = (w: number, h: number, pp: Partial<typeof PP> = {}) => buildSettingsFromRedesign({ pp: { ...PP, ...pp }, psType: "bt", psOut: "sticker", psSize: `${w}x${h}mm` });
const flags = (compact: boolean): RasterSettings => ({ printStickerQr: false, printCommentFullWidth: true, ...spacingFlagsFor(true, compact ? "compact" : "normal") });
describe("fit warning", () => {
  it("the fixed sample: a 20-letter three-word name and a 27-character six-word comment", () => {
    expect(FIT_SAMPLE_NAME.split(" ")).toHaveLength(3);
    expect(FIT_SAMPLE_NAME.replace(/ /g, "")).toHaveLength(20);
    expect(FIT_SAMPLE_COMMENT).toHaveLength(27);
    expect(FIT_SAMPLE_COMMENT.split(" ")).toHaveLength(6);
  });
  it("silent at the default pattern on every size, Normal and Compact", () => {
    for (const [w, h] of SIZES) for (const compact of [false, true]) {
      expect(stickerFit(cfgFor(w, h), "NT$", "My Shop", flags(compact)), `${w}x${h} ${compact}`).toEqual({ overflow: false, commentScale: null, cut: false });
    }
  });
  it("comment 3× on 60x40 → says which scale will print", () => {
    const f = stickerFit(cfgFor(60, 40, { commentSize: 3 }), "NT$", "My Shop", flags(false));
    expect(f.commentScale).toBe(2);
  });
  it("name 2× on 70x50 → fewer name letters than at 1×", () => {
    expect(stickerFit(cfgFor(70, 50, { tiktokNameSize: 2 }), "NT$", "My Shop", flags(false)).cut).toBe(true);
  });
  it("past the right edge → overflow (@username 3× on 60x40 is wider than the label)", () => {
    expect(stickerFit(cfgFor(60, 40, { tiktokUserSize: 3 }), "NT$", "My Shop", flags(false)).overflow).toBe(true);
    expect(stickerFit(cfgFor(60, 40), "NT$", "My Shop", flags(false)).overflow).toBe(false);
  });
});
