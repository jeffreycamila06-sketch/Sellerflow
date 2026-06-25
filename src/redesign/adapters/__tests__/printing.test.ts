// Phase 5g — BYTE-PARITY test for the printing payload builders. Asserts the
// redesign adapter produces output byte-for-byte identical to a VERBATIM copy of
// App.tsx's builders (the native TSPL/ESC-POS payload shape is DO-NOT-TOUCH).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildNativeStickerPayload, buildSlipPayload, buildSettingsFromRedesign, DEF_SETTINGS, type Settings } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

// ── VERBATIM reference from src/App.tsx:519-585, 658-659. If App.tsx changes,
// update BOTH this reference and the adapter together — this test is the guard.
const REF_LABELS: Record<string, { w: number; h: number }> = { "100x60": { w: 100, h: 60 }, "80x60": { w: 80, h: 60 }, "80x50": { w: 80, h: 50 }, "70x50": { w: 70, h: 50 }, "60x40": { w: 60, h: 40 } };
const REF_FALLBACK = "100x60";
const refKey = (size: string | undefined) => { const k = (size || "").replace(/mm$/i, ""); return k in REF_LABELS ? k : REF_FALLBACK; };
const refLabel = (size: string | undefined) => REF_LABELS[refKey(size)];
function refSticker(buyer: Buyer, cur: string, storeName: string, cfg: Settings) {
  const sessionDate = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const localizedOrders = buyer.orders.map(o => {
    const ts = typeof o.orderNum === "number" ? o.orderNum : 0;
    const time = ts > 1e12 ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : o.time;
    return { ...o, time };
  });
  const label = refLabel(cfg.stickerSize);
  return { storeName, sessionDate, currency: cur, buyer: { ...buyer, orders: localizedOrders }, labelWidthMm: label.w, labelHeightMm: label.h, settings: { printStoreName: cfg.printStoreName, printBuyerNumber: cfg.printBuyerNumber, printBuyerUsername: cfg.printBuyerUsername, printOrderItems: cfg.printOrderItems, printTotal: cfg.printTotal, printStoreScale: cfg.printStoreScale, printBuyerNumberScale: cfg.printBuyerNumberScale, printBuyerNameScale: cfg.printBuyerNameScale, printUsernameScale: cfg.printUsernameScale, printOrderScale: cfg.printOrderScale, printCommentScale: cfg.printCommentScale, printTotalScale: cfg.printTotalScale } };
}
function refSlip(buyer: Buyer, cur: string, storeName: string, cfg: Settings) {
  const sess = new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Taipei", month: "long", day: "numeric", year: "numeric" });
  return { type: "sellerflow.printSlip", buyer, currency: cur, storeName, settings: cfg, sessionDate: sess, createdAt: new Date().toISOString() };
}

const order = (over: Record<string, unknown> = {}) => ({ orderNum: 1750000000000, item: "mine red lipstick", qty: 1, price: 320, total: 320, time: "9:41:00 PM", handle: "annc", name: "Ann Cruz", bNum: 1, platform: "TikTok", status: "New", date: "2026-06-26", ...over });
const buyer = (over: Partial<Buyer> = {}): Buyer => ({ handle: "annc", name: "Ann Cruz", platform: "TikTok", num: 1, orders: [order()], totalOrders: 1, totalSpent: 320, ...over } as Buyer);
const cfg = (over: Partial<Settings> = {}): Settings => ({ ...DEF_SETTINGS, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-06-26T05:30:00.000Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("buildNativeStickerPayload — byte-parity with App.tsx", () => {
  const sizes = ["100x60", "80x60", "80x50", "70x50", "60x40", "100x60mm", "weird-size"];
  it("matches verbatim reference across all paper sizes (byte-for-byte)", () => {
    for (const stickerSize of sizes) {
      const b = buyer(), c = cfg({ stickerSize });
      expect(JSON.stringify(buildNativeStickerPayload(b, "NT$", "Taipei Shop", c)))
        .toBe(JSON.stringify(refSticker(b, "NT$", "Taipei Shop", c)));
    }
  });
  it("matches with toggles off + custom scales + CJK buyer name (Chinese)", () => {
    const b = buyer({ name: "陳美麗", handle: "meili_tw", orders: [order({ name: "陳美麗", handle: "meili_tw" })] });
    const c = cfg({ printStoreName: false, printTotal: false, printBuyerNameScale: 4, printOrderScale: 2 });
    expect(JSON.stringify(buildNativeStickerPayload(b, "NT$", "店舖", c))).toBe(JSON.stringify(refSticker(b, "NT$", "店舖", c)));
  });
  it("preserves orderNum epoch ms and re-derives Taipei time only when > 1e12", () => {
    const b = buyer({ orders: [order({ orderNum: 1750000000000 }), order({ orderNum: 42, time: "raw-seq" })] });
    const out = buildNativeStickerPayload(b, "NT$", "Shop", cfg());
    expect(out.buyer.orders[0].orderNum).toBe(1750000000000); // unchanged
    expect(out.buyer.orders[1].time).toBe("raw-seq");          // < 1e12 keeps original
    expect(JSON.stringify(out)).toBe(JSON.stringify(refSticker(b, "NT$", "Shop", cfg())));
  });
  it("clamps unknown sticker size to 100x60 (fallback)", () => {
    expect(buildNativeStickerPayload(buyer(), "NT$", "Shop", cfg({ stickerSize: "999x999" })).labelWidthMm).toBe(100);
  });
});

describe("buildSlipPayload — byte-parity with App.tsx", () => {
  it("matches verbatim reference (shape + Taipei session date + createdAt)", () => {
    const b = buyer(), c = cfg();
    expect(JSON.stringify(buildSlipPayload(b, "NT$", "Taipei Shop", c))).toBe(JSON.stringify(refSlip(b, "NT$", "Taipei Shop", c)));
  });
});

describe("buildSettingsFromRedesign — redesign config → Settings", () => {
  const pp = { shopName: true, shopNameSize: 2, dateTime: false, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1.4, tiktokName: false, tiktokNameSize: 3, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 2.6 };
  it("maps toggles 1:1 and sizes (0.5–3.0) → integer levels (1–8)", () => {
    const s = buildSettingsFromRedesign({ pp, psType: "bt", psOut: "sticker", psSize: "80x50mm" });
    expect(s.printStoreName).toBe(true);
    expect(s.printDateTime).toBe(false);
    expect(s.printBuyerName).toBe(false);   // tiktokName off
    expect(s.printOrderItems).toBe(true);   // comment on
    expect(s.printStoreScale).toBe(2);      // 2 → 2
    expect(s.printBuyerNumberScale).toBe(1); // 1.4 → 1
    expect(s.printOrderScale).toBe(3);      // 2.6 → 3
    expect(s.printerType).toBe("bluetooth");
    expect(s.lanFormat).toBe("sticker");
    expect(s.stickerSize).toBe("80x50");    // parsed from "80x50mm"
  });
  it("maps wifi/receipt + parses standard label", () => {
    const s = buildSettingsFromRedesign({ pp, psType: "wifi", psOut: "receipt", psSize: "100x60mm (Standard)" });
    expect(s.printerType).toBe("lan");
    expect(s.lanFormat).toBe("receipt");
    expect(s.stickerSize).toBe("100x60");
  });
});
