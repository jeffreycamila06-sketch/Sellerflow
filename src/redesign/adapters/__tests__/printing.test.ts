// Phase 5g — BYTE-PARITY test for the printing payload builders. Asserts the
// redesign adapter produces output byte-for-byte identical to a VERBATIM copy of
// App.tsx's builders (the native TSPL/ESC-POS payload shape is DO-NOT-TOUCH).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildNativeStickerPayload, buildSlipPayload, buildSettingsFromRedesign, printSlip, __resetWebPrintQueue, __webPrintIdle, stickerBitmapFor, bitmapBmpDataUrl, DEF_SETTINGS, type Settings } from "../printing";
import { rasterFromBmpDataUrl } from "./printControls.harness";
import type { FullRaster } from "../stickerRaster";
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
  return { storeName, sessionDate, currency: cur, buyer: { ...buyer, orders: localizedOrders }, labelWidthMm: label.w, labelHeightMm: label.h, settings: { printStoreName: cfg.printStoreName, printBuyerNumber: cfg.printBuyerNumber, printBuyerUsername: cfg.printBuyerUsername, printOrderItems: cfg.printOrderItems, printTotal: false, printBuyerName: cfg.printBuyerName !== false, printDateTime: cfg.printDateTime !== false, /* Nov 3 item 2: the two switches ride the payload (native builders default them to true) */ printStoreScale: cfg.printStoreScale, printBuyerNumberScale: cfg.printBuyerNumberScale, printBuyerNameScale: cfg.printBuyerNameScale, printUsernameScale: cfg.printUsernameScale, printOrderScale: cfg.printOrderScale, printCommentScale: cfg.printCommentScale, printTotalScale: cfg.printTotalScale } };
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

describe("printSlip — the laptop prints THE sticker bitmap as one image on a label-sized page (round 3, item 7)", () => {
  // Capture the iframe printSlip creates so we can spy its contentWindow.print.
  let captured: HTMLIFrameElement | null;
  beforeEach(() => {
    captured = null;
    __resetWebPrintQueue(); // serialized queue holds module state across calls; isolate cases
    vi.useFakeTimers();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === "iframe") captured = el as HTMLIFrameElement;
      return el;
    });
  });
  afterEach(() => { __resetWebPrintQueue(); vi.restoreAllMocks(); vi.useRealTimers(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });
  const webHtml = () => captured?.contentDocument?.documentElement.outerHTML || "";

  it("appends a hidden iframe, writes the label-sized page holding the sticker image, calls win.print(), returns via:'browser'", async () => {
    // jsdom has no window.SellerFlowPrinter → native paths skip → browser fallback runs.
    const b = buyer({ num: 1, name: "Ann Cruz", handle: "annc", totalSpent: 320 }), c = cfg({ stickerSize: "60x40" });
    const r = printSlip(b, "NT$", "My Shop", c);
    expect(r).toEqual({ ok: true, via: "browser" });
    await __webPrintIdle();
    expect(captured).not.toBeNull();
    expect(document.body.contains(captured)).toBe(true);
    const html = webHtml();
    expect(html).toContain("@page{size:60mm 40mm;margin:0}"); // the page IS the label
    expect(html).toContain("width:60mm;height:40mm");
    expect(html).toMatch(/<img alt="" src="data:image\/bmp;base64,/);
    expect(html).not.toMatch(/<(div|span|p)[ >]/);              // no browser text layout — preview == print by construction
    // the image IS the preview bitmap: stickerBitmapFor, path "browser", the same payload
    const expected = await stickerBitmapFor({ path: "browser", payload: buildNativeStickerPayload(b, "NT$", "My Shop", c), platform: "TikTok" });
    expect(html).toContain(bitmapBmpDataUrl(expected));
    // window.print fires after the (trimmed) pre-print timeout
    const printSpy = vi.spyOn(captured!.contentWindow as Window, "print").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(60);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("the page is the label's size for every sticker size; the string-settings overload too", async () => {
    printSlip(buyer(), "NT$", "Shop", cfg({ stickerSize: "80x50" }));
    await __webPrintIdle();
    expect(webHtml()).toContain("@page{size:80mm 50mm;margin:0}");
    __resetWebPrintQueue();
    const r = printSlip(buyer(), "NT$", "Shop", "100x60");
    expect(r).toEqual({ ok: true, via: "browser" });
    await __webPrintIdle();
    expect(webHtml()).toContain("@page{size:100mm 60mm;margin:0}");
  });

  it("the BMP data URL round-trips the raster exactly (1-bit, bottom-up rows padded to 4 bytes)", () => {
    const r: FullRaster = { w: 13, h: 3, rowBytes: 2, buf: new Uint8Array([0b10100000, 0b00001000, 0b11111111, 0b11111000, 0b00000001, 0b00000000]) };
    const src = bitmapBmpDataUrl(r);
    expect(src.startsWith("data:image/bmp;base64,Qk")).toBe(true); // "BM"
    const back = rasterFromBmpDataUrl(src);
    expect([back.w, back.h, back.rowBytes]).toEqual([13, 3, 2]);
    expect(Array.from(back.buf)).toEqual(Array.from(r.buf));
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
