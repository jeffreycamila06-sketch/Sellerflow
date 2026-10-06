// Sticker QR: none for Facebook buyers. The QR is a TikTok profile link; a Facebook buyer's
// "handle" is a display name, so a Facebook order prints NO QR and the sticker is laid out
// exactly as with the QR toggle off. TikTok (and legacy orders with no platform) unchanged.
// Both QR decision points: the phone bitmap path and the browser-print path.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  printSlip, setStickerQrOn, setStickerQrEntitled, stickerQrAllowedFor, __resetWebPrintQueue, LS_CLASSIC_TEXT,
  DEF_SETTINGS, type Settings,
} from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

type W = { SellerFlowPrinter?: unknown; Capacitor?: unknown };
const order = (platform: string | undefined) => ({ orderNum: 1750000000000, item: "A01", qty: 1, price: 320, total: 320, time: "9:41 PM", handle: "annc", name: "Ann Cruz", bNum: 12, platform, status: "New", date: "2026-09-26" });
const buyer = (platform: string | undefined): Buyer => ({ handle: "annc", name: "Ann Cruz", platform, num: 12, orders: [order(platform)], totalOrders: 1, totalSpent: 320 } as unknown as Buyer);
// Node 26's jsdom has no localStorage; the QR toggle lives there → a tiny in-memory one.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
});
const btCfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "100x60" };

describe("stickerQrAllowedFor", () => {
  it("Facebook (any case) → false; TikTok, Shopee, missing → true", () => {
    for (const p of ["Facebook", "facebook", " FACEBOOK "]) expect(stickerQrAllowedFor(p)).toBe(false);
    for (const p of ["TikTok", "Shopee", "", undefined, null]) expect(stickerQrAllowedFor(p)).toBe(true);
  });
});

describe("phone (bitmap) sticker", () => {
  let bitmap: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.removeItem(LS_CLASSIC_TEXT);
    bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    setStickerQrEntitled(true);
  });
  afterEach(() => { delete (window as W).SellerFlowPrinter; setStickerQrOn(false); setStickerQrEntitled(false); });

  async function print(platform: string | undefined, qrOn: boolean): Promise<string> {
    setStickerQrOn(qrOn);
    const before = bitmap.mock.calls.length;
    printSlip(buyer(platform), "NT$", "My Shop", btCfg);
    await vi.waitFor(() => expect(bitmap.mock.calls.length).toBe(before + 1));
    return (bitmap.mock.calls[before][0] as { data: string }).data;
  }

  it("TikTok order: QR on differs from QR off (the QR is stamped) — unchanged behaviour", async () => {
    const off = await print("TikTok", false);
    const on = await print("TikTok", true);
    expect(on).not.toBe(off);
  });
  it("legacy order with no platform: QR on still stamps the QR", async () => {
    expect(await print(undefined, true)).toBe(await print("TikTok", true));
  });
  it("Facebook order + QR on → byte-identical to QR off (no QR, same layout)", async () => {
    const fbOn = await print("Facebook", true);
    const fbOff = await print("Facebook", false);
    const ttOff = await print("TikTok", false);
    expect(fbOn).toBe(fbOff);
    expect(fbOn).not.toBe(ttOff); // Facebook name only (fbName.ts): no "@name" line → differs from TikTok
  });
  // ── Replacement pins for the old "Facebook label = TikTok label" check, where it still applies ──
  async function printWith(b: Buyer, cfg: Settings): Promise<string> {
    setStickerQrOn(false);
    const before = bitmap.mock.calls.length;
    printSlip(b, "NT$", "My Shop", cfg);
    await vi.waitFor(() => expect(bitmap.mock.calls.length).toBe(before + 1));
    return (bitmap.mock.calls[before][0] as { data: string }).data;
  }
  it("username line OFF: a Facebook label is byte-identical to the TikTok label for the same buyer (nothing changes)", async () => {
    const off: Settings = { ...btCfg, printBuyerUsername: false };
    expect(await printWith(buyer("Facebook"), off)).toBe(await printWith(buyer("TikTok"), off));
  });
  it("Facebook comment with no name (\"Unknown\", handle = the id): byte-identical to main's output before this change", async () => {
    // sha256 captured by running this exact print on origin/main 711bc20 (clock pinned to 2026-10-06T04:00Z)
    const MAIN_SHA256 = "544aa261c1e7cde12f351eab493ab776fe85f7d575aea355e10d1364aacee39c";
    vi.useFakeTimers({ now: new Date("2026-10-06T04:00:00Z"), toFake: ["Date"] });
    try {
      const ID = "1029384756473829";
      const o = { ...order("Facebook"), handle: ID, name: "Unknown" };
      const b = { handle: ID, name: "Unknown", platform: "Facebook", num: 12, orders: [o], totalOrders: 1, totalSpent: 320 } as unknown as Buyer;
      const data = await printWith(b, btCfg);
      expect(data).toHaveLength(4192);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
      expect([...digest].map((x) => x.toString(16).padStart(2, "0")).join("")).toBe(MAIN_SHA256);
    } finally { vi.useRealTimers(); }
  });
});

describe("browser-print sticker", () => {
  let captured: HTMLIFrameElement | null;
  beforeEach(() => {
    captured = null;
    __resetWebPrintQueue();
    vi.useFakeTimers();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === "iframe") captured = el as HTMLIFrameElement;
      return el;
    });
    setStickerQrEntitled(true);
  });
  afterEach(() => {
    setStickerQrOn(false); setStickerQrEntitled(false);
    __resetWebPrintQueue(); vi.restoreAllMocks(); vi.useRealTimers();
    document.querySelectorAll("iframe").forEach((f) => f.remove());
  });
  const html = (platform: string, qrOn: boolean) => {
    setStickerQrOn(qrOn);
    __resetWebPrintQueue();
    printSlip(buyer(platform), "NT$", "My Shop", { ...DEF_SETTINGS });
    return captured?.contentDocument?.documentElement.outerHTML || "";
  };

  it("TikTok + QR on → the QR is there (unchanged)", () => {
    expect(html("TikTok", true)).toContain('<svg class="qr"');
  });
  it("Facebook + QR on → no QR and the same page as QR off", () => {
    const fbOn = html("Facebook", true);
    expect(fbOn).not.toContain('class="qr"');
    expect(fbOn).toBe(html("Facebook", false));
  });
});
