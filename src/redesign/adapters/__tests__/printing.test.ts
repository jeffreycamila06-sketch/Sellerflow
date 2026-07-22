// Phase 5g — BYTE-PARITY test for the printing payload builders. Asserts the
// redesign adapter produces output byte-for-byte identical to a VERBATIM copy of
// App.tsx's builders (the native TSPL/ESC-POS payload shape is DO-NOT-TOUCH).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildNativeStickerPayload, buildSlipPayload, buildSettingsFromRedesign, printSlip, DEF_SETTINGS, type Settings } from "../printing";
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
  return { storeName, sessionDate, currency: cur, buyer: { ...buyer, orders: localizedOrders }, labelWidthMm: label.w, labelHeightMm: label.h, settings: { printStoreName: cfg.printStoreName, printBuyerNumber: cfg.printBuyerNumber, printBuyerUsername: cfg.printBuyerUsername, printOrderItems: cfg.printOrderItems, printTotal: false, printStoreScale: cfg.printStoreScale, printBuyerNumberScale: cfg.printBuyerNumberScale, printBuyerNameScale: cfg.printBuyerNameScale, printUsernameScale: cfg.printUsernameScale, printOrderScale: cfg.printOrderScale, printCommentScale: cfg.printCommentScale, printTotalScale: cfg.printTotalScale } };
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
  it("ALWAYS forces printTotal:false on the sticker (Total removed, all sizes) even when cfg.printTotal is true", () => {
    for (const stickerSize of ["100x60", "80x60", "80x50", "70x50", "60x40"]) {
      expect(buildNativeStickerPayload(buyer(), "NT$", "Shop", cfg({ stickerSize, printTotal: true })).settings.printTotal).toBe(false);
    }
  });
  it("does NOT strip Total from the SLIP payload (sticker-only change)", () => {
    expect(buildSlipPayload(buyer(), "NT$", "Shop", cfg({ printTotal: true })).settings.printTotal).toBe(true);
  });
});

describe("buildSlipPayload — byte-parity with App.tsx", () => {
  it("matches verbatim reference (shape + Taipei session date + createdAt)", () => {
    const b = buyer(), c = cfg();
    expect(JSON.stringify(buildSlipPayload(b, "NT$", "Taipei Shop", c))).toBe(JSON.stringify(refSlip(b, "NT$", "Taipei Shop", c)));
  });
});

describe("printSlip — web browser print MIRRORS the native TSPL sticker layout", () => {
  // Capture the iframe printSlip creates so we can spy its contentWindow.print.
  let captured: HTMLIFrameElement | null;
  beforeEach(() => {
    captured = null;
    vi.useFakeTimers();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === "iframe") captured = el as HTMLIFrameElement;
      return el;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });
  const webHtml = () => captured?.contentDocument?.documentElement.outerHTML || "";

  it("appends a hidden iframe, writes the sticker-mirror HTML, calls win.print(), returns via:'browser'", () => {
    // jsdom has no window.SellerFlowPrinter → native paths skip → browser fallback runs.
    const r = printSlip(buyer({ num: 1, name: "Ann Cruz", handle: "annc", totalSpent: 320 }), "NT$", "My Shop", cfg());
    expect(r).toEqual({ ok: true, via: "browser" });
    expect(captured).not.toBeNull();
    expect(document.body.contains(captured)).toBe(true);
    const html = webHtml();
    // Sticker content parity: brand header, dominant Buyer #, name, @username.
    expect(html).toContain("SellerFlowLive");
    expect(html).toContain("Buyer #1");
    expect(html).toContain("Ann Cruz");
    expect(html).toContain("@annc");
    // window.print fires after the 120ms timeout
    const printSpy = vi.spyOn(captured!.contentWindow as Window, "print").mockImplementation(() => {});
    vi.advanceTimersByTime(150);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("NO Total and NO 'Order here' — the old 2-column slip layout is gone", () => {
    printSlip(buyer({ totalSpent: 999, num: 3 }), "NT$", "Shop", cfg({ printTotal: true }));
    const html = webHtml();
    expect(html).not.toContain("Total");   // sticker parity (printTotal forced off)
    expect(html).not.toContain("Order here");
    expect(html).not.toContain("999");     // no amount anywhere
  });

  it("caps order rows at 2 (native maxOrders) with the enlarged price-code element, item truncated to 12", () => {
    const b = buyer();
    b.orders = [1, 2, 3].map((i) => ({ ...b.orders[0], orderNum: i, time: `10:0${i}`, item: `CODE-${i}-VERYLONGTAIL` }));
    printSlip(b, "NT$", "Shop", cfg());
    const html = webHtml();
    expect(html.match(/class="orow"/g)).toHaveLength(2);          // max 2 rows
    expect(html).toContain('class="oitem"');                       // enlarged price code
    expect(html).toContain("CODE-1-VERYL");                        // truncate(12)
    expect(html).not.toContain("CODE-3");                          // 3rd order dropped
  });

  it("uses the label size for @page and the compact 40mm tier for 60x40", () => {
    printSlip(buyer(), "NT$", "Shop", cfg({ stickerSize: "60x40" }));
    expect(webHtml()).toContain("size:60mm 40mm");
    printSlip(buyer(), "NT$", "Shop", cfg({ stickerSize: "80x50" }));
    expect(webHtml()).toContain("size:80mm 50mm");
  });

  it("prints the Taipei date (MM/DD/YYYY family), not the old en-PH long date", () => {
    printSlip(buyer(), "NT$", "Shop", cfg());
    const html = webHtml();
    expect(html).toMatch(/\d{2}\/\d{2}\/\d{4}/); // en-US Taipei date
    expect(html).not.toContain("Session:");        // old slip header removed
  });

  it("respects the print-pattern toggles (store name / buyer# / username off)", () => {
    printSlip(buyer({ handle: "annc" }), "NT$", "My Shop", cfg({ printStoreName: false, printBuyerNumber: false, printBuyerUsername: false }));
    const html = webHtml();
    expect(html).not.toContain("My Shop");
    expect(html).not.toContain("Buyer #");
    expect(html).not.toContain("@annc");
  });

  it("scales each field by its pattern-settings multiplier (per-element, like the native cmul)", () => {
    // 100x60 base tier: bnum 9mm, name 5.4mm. Level 2 doubles them.
    printSlip(buyer(), "NT$", "Shop", cfg({ printBuyerNumberScale: 2, printBuyerNameScale: 2 }));
    let html = webHtml();
    expect(html).toContain(".bnum{font-size:18mm");   // 9 * 2
    expect(html).toContain(".name{font-size:10.8mm"); // 5.4 * 2
    // level 1 (default) stays at base
    printSlip(buyer(), "NT$", "Shop", cfg());
    html = webHtml();
    expect(html).toContain(".bnum{font-size:9mm");
    expect(html).toContain(".name{font-size:5.4mm");
  });

  it("string-settings overload also browser-prints", () => {
    const r = printSlip(buyer(), "NT$", "Shop", "80x50");
    expect(r).toEqual({ ok: true, via: "browser" });
    expect(captured).not.toBeNull();
  });
});

describe("DEF_SETTINGS — drift guard (copied from App.tsx:175)", () => {
  it("pins the load-bearing print defaults", () => {
    expect(DEF_SETTINGS.printerType).toBe("lan");
    expect(DEF_SETTINGS.lanFormat).toBe("receipt");
    expect(DEF_SETTINGS.stickerSize).toBe("100x60");
    expect(DEF_SETTINGS.printStoreName).toBe(true);
    expect(DEF_SETTINGS.printTotal).toBe(true);
    expect(DEF_SETTINGS.printAutoClose).toBe(true);
    expect(DEF_SETTINGS.printStoreScale).toBe(1);
    expect(DEF_SETTINGS.printOrderScale).toBe(1);
  });
});

describe("buildSettingsFromRedesign → buildNativeStickerPayload (5i config → 5g payload)", () => {
  it("propagates toggles, scales, and paper size into the native sticker payload", () => {
    const pp = { shopName: false, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 2, tiktokName: true, tiktokNameSize: 1, tiktokUser: false, tiktokUserSize: 1, comment: true, commentSize: 1 };
    const s = buildSettingsFromRedesign({ pp, psType: "bt", psOut: "sticker", psSize: "80x50mm" });
    const payload = buildNativeStickerPayload(buyer(), "NT$", "Shop", s);
    expect(payload.settings.printStoreName).toBe(false);      // pp.shopName off
    expect(payload.settings.printBuyerUsername).toBe(false);   // pp.tiktokUser off
    expect(payload.settings.printBuyerNumberScale).toBe(2);    // size 2 → level 2
    expect(payload.labelWidthMm).toBe(80);
    expect(payload.labelHeightMm).toBe(50);
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
    expect(s.printOrderScale).toBe(1);      // TIME pinned to base (decoupled from commentSize 2026-07-22)
    expect(s.printCommentScale).toBe(3);    // price code still tracks: 2.6 → 3
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

// ── TIME-DECOUPLE CONTRACT (2026-07-22) ──────────────────────────────────────
// The order-row TIME (printOrderScale → tm in all 3 builders + the web-print
// .otime) must NEVER scale with the Comment control; the price code
// (printCommentScale → pm) must ALWAYS track it. If printOrderScale ever gets
// re-coupled to commentSize, the printed time grows/moves again — red here.
describe("time decouple — printOrderScale pinned, printCommentScale tracks", () => {
  const basePp = { shopName: true, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };
  it("printOrderScale is 1 for EVERY commentSize; printCommentScale follows the control", () => {
    for (let i = 5; i <= 30; i++) {
      const v = i / 10;
      const s = buildSettingsFromRedesign({ pp: { ...basePp, commentSize: v }, psType: "bt", psOut: "sticker", psSize: "100x60mm (Standard)" });
      expect(s.printOrderScale).toBe(1);
      expect(s.printCommentScale).toBe(Math.max(1, Math.min(8, Math.round(v))));
    }
  });
  it("other element scales are unaffected by commentSize", () => {
    const s = buildSettingsFromRedesign({ pp: { ...basePp, commentSize: 3, shopNameSize: 2 }, psType: "bt", psOut: "sticker", psSize: "100x60mm (Standard)" });
    expect(s.printStoreScale).toBe(2);
    expect(s.printBuyerNumberScale).toBe(1);
    expect(s.printUsernameScale).toBe(1);
  });
});
