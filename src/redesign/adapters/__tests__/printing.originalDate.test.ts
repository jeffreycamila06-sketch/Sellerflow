// Past-session Reprint = an exact copy of the ORIGINAL sticker. printSlip takes an OPTIONAL
// order instant (opts.at) that only the past-session Reprint passes: the header date becomes
// that order's own Taipei date. Proof per route: printing with at=T today gives EXACTLY the
// output printed on day T without it (bytes / payload / HTML). Without opts every route prints
// today, as before.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { printSlip, buildNativeStickerPayload, buildSlipPayload, __resetWebPrintQueue, DEF_SETTINGS, type Settings } from "../printing";
import { performReprint, originalPrintInstant } from "../reprint";
import type { Buyer } from "../../../lib/orderTypes";

type W = { SellerFlowPrinter?: unknown; Capacitor?: unknown };
const ORDER_AT = Date.parse("2026-10-08T04:30:00.000Z");   // 10/08 12:30 Taipei
const NEXT_DAY = Date.parse("2026-10-08T16:05:00.000Z");   // 10/09 00:05 Taipei (live crossed midnight)
const NOW = Date.parse("2026-10-14T06:00:00.000Z");        // 10/14 Taipei
const buyer: Buyer = {
  handle: "@ann", name: "Ann", platform: "TikTok", num: 3, totalSpent: 150, totalOrders: 1,
  orders: [{ orderNum: ORDER_AT, item: "A1", qty: 1, price: 150, total: 150, time: "12:30:00 PM", handle: "@ann", name: "Ann", bNum: 3, platform: "TikTok", status: "New", date: "2026-10-08" }],
};
const bt: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const lan: Settings = { ...DEF_SETTINGS, printerType: "lan", lanFormat: "sticker" };
const slip: Settings = { ...DEF_SETTINGS, printerType: "lan", lanFormat: "receipt" };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const at = (t: number) => vi.setSystemTime(t);

// One print on a route; returns what reached the printer.
async function run(route: "bitmap" | "text" | "lan" | "slip" | "web", opts?: { at?: number }): Promise<unknown> {
  const seen: unknown[] = [];
  const grab = vi.fn(async (p: unknown) => { seen.push(p); return { ok: true }; });
  if (route === "bitmap") (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: grab };
  if (route === "text") (window as W).SellerFlowPrinter = { printStickerNative: grab };
  if (route === "lan") (window as W).SellerFlowPrinter = { printStickerLan: grab };
  if (route === "slip") (window as W).SellerFlowPrinter = { printSlip: (p: unknown) => { seen.push(p); return { ok: true }; } };
  const cfg = route === "bitmap" || route === "text" ? bt : route === "lan" ? lan : slip;
  if (opts) printSlip(buyer, "NT$", "Shop", cfg, opts); else printSlip(buyer, "NT$", "Shop", cfg);
  await flush();
  if (route === "web") return (document.querySelector("iframe") as HTMLIFrameElement).contentDocument!.documentElement.outerHTML;
  return JSON.parse(JSON.stringify(seen[0]));
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); __resetWebPrintQueue(); });
afterEach(() => {
  vi.useRealTimers(); delete (window as W).SellerFlowPrinter; delete (window as W).Capacitor;
  __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
});

describe("opts.at = the original order's instant (past-session Reprint)", () => {
  for (const route of ["bitmap", "text", "lan", "slip", "web"] as const) {
    it(`${route}: printing today with at=10/08 is byte-identical to printing ON 10/08`, async () => {
      at(ORDER_AT); const original = await run(route);
      __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
      at(NOW); const reprint = await run(route, { at: ORDER_AT });
      expect(reprint).toEqual(original);
      __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
      at(NOW); const today = await run(route);       // without at → today's date, as before
      expect(today).not.toEqual(original);
    });
  }
  it("the header date strings: sticker 10/08/2026, slip 'October 8, 2026'; 00:05 after midnight → the next day", () => {
    at(NOW);
    expect(buildNativeStickerPayload(buyer, "NT$", "Shop", bt, ORDER_AT).sessionDate).toBe("10/08/2026");
    expect(buildNativeStickerPayload(buyer, "NT$", "Shop", bt, NEXT_DAY).sessionDate).toBe("10/09/2026");
    expect(buildSlipPayload(buyer, "NT$", "Shop", slip, ORDER_AT).sessionDate).toBe("October 8, 2026");
    expect(buildSlipPayload(buyer, "NT$", "Shop", slip, ORDER_AT).createdAt).toBe(new Date(ORDER_AT).toISOString());
    expect(buildNativeStickerPayload(buyer, "NT$", "Shop", bt).sessionDate).toBe("10/14/2026"); // default = today
  });
  it("web/kiosk HTML shows the order's date", async () => {
    at(NOW);
    expect(await run("web", { at: ORDER_AT })).toContain("10/08/2026");
    __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
    expect(await run("web", { at: NEXT_DAY })).toContain("10/09/2026");
  });
});

describe("performReprint", () => {
  const row = { buyer_number: 3, handle: "@ann", customer_name: "Ann", platform: "TikTok", product: "A1", price: 150, created_at: new Date(NEXT_DAY).toISOString(), session_date: "2026-10-08" };
  it("originalDate → the row's created_at instant (not session_date): 00:05 next day prints 10/09", async () => {
    at(NOW);
    expect(originalPrintInstant(row)).toBe(NEXT_DAY);
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(async () => ({ ok: true })) };
    performReprint(row, "NT$", "Shop", bt, { originalDate: true });
    await flush();
    const p = ((window as W).SellerFlowPrinter as { printStickerNative: ReturnType<typeof vi.fn> }).printStickerNative.mock.calls[0][0];
    expect(p.sessionDate).toBe("10/09/2026");
  });
  it("without originalDate (current-session Reprint / Dashboard ↻) → today, as before", async () => {
    at(NOW);
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(async () => ({ ok: true })) };
    performReprint(row, "NT$", "Shop", bt);
    await flush();
    const p = ((window as W).SellerFlowPrinter as { printStickerNative: ReturnType<typeof vi.fn> }).printStickerNative.mock.calls[0][0];
    expect(p.sessionDate).toBe("10/14/2026");
  });
  it("only the past-session path asks for the original date (source contract)", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app.match(/originalDate: true/g)).toHaveLength(1);
    expect(app).toMatch(/const onReprintRow = [\s\S]{0,200}performReprint\(row, pc\.cur, pc\.storeName, pc\.settings, \{ originalDate: true \}\)/);
    expect(app.match(/printSlip\([^)]*\{ at/g)).toBeNull();
  });
});
