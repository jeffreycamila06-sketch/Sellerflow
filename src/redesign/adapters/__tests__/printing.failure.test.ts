// "No printer connected" surfacing — the native bridge fails an order-print
// silently today; setNativePrintFailureHandler lets RedesignApp catch it and show
// the modal. Pins: (1) isPrinterNotSetup only matches the two config-missing codes
// (Jeff's two triggers) + a message fallback; every other code is left alone;
// (2) the BT/LAN sticker helpers forward {code,message,via} to the handler on
// BOTH failure shapes (resolved {ok:false} AND a Capacitor reject); (3) a consumed
// failure returns from printSlip's SYNC path as ok:true (Option A — the order flow
// never sees the async print failure). printSlip's signature is unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { printSlip, isPrinterNotSetup, setNativePrintFailureHandler, type NativePrintFailure } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const buyer = (): Buyer => ({
  handle: "ann", name: "Ann", platform: "TikTok", num: 5,
  orders: [{ orderNum: Date.now(), item: "D", qty: 1, price: 300, total: 300, time: "9:41", handle: "ann", name: "Ann", bNum: 5, platform: "TikTok", status: "New", date: "2026-07-15" }],
  totalSpent: 300, totalOrders: 1,
} as Buyer);

const btSettings = { printerType: "bluetooth" as const, lanFormat: "receipt" as const, stickerSize: "100x60" };
const lanSettings = { printerType: "lan" as const, lanFormat: "sticker" as const, stickerSize: "100x60" };

describe("isPrinterNotSetup — Jeff's two triggers only", () => {
  it("matches the config-missing codes", () => {
    expect(isPrinterNotSetup("BT_NOT_SET", "")).toBe(true);
    expect(isPrinterNotSetup("PRINTER_NOT_SET", "")).toBe(true);
  });
  it("leaves every other native code alone", () => {
    for (const c of ["BT_NOT_FOUND", "BT_OFF", "BT_PERMISSION", "BT_PRINT_FAILED", "BT_BUSY", "BT_UNAVAILABLE"]) {
      expect(isPrinterNotSetup(c, "anything")).toBe(false);
    }
  });
  it("falls back to the message ONLY when there is no code (older binaries)", () => {
    expect(isPrinterNotSetup("", "No Bluetooth printer saved. Tap Scan…")).toBe(true);
    expect(isPrinterNotSetup("", "No WiFi printer saved. Enter printer IP and tap Test Connection first.")).toBe(true);
    expect(isPrinterNotSetup("", "No printer selected. Tap Scan and pick a printer first.")).toBe(true);
    expect(isPrinterNotSetup("", "Bluetooth is off. Turn it on…")).toBe(false);
    expect(isPrinterNotSetup("", "")).toBe(false);
  });
});

// --- Native bridge harness: a fake window.SellerFlowPrinter that fails ---------
type PrinterStub = { printStickerNative?: (p: unknown) => Promise<unknown>; printStickerLan?: (p: unknown) => Promise<unknown>; printSlip?: (p: unknown) => Promise<unknown> };
function withBridge(stub: PrinterStub) {
  (globalThis as unknown as { window: { SellerFlowPrinter: PrinterStub } }).window = { SellerFlowPrinter: stub } as never;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("printSlip → native failure forwarding", () => {
  let seen: NativePrintFailure[];
  beforeEach(() => { seen = []; setNativePrintFailureHandler((info) => { seen.push(info); return true; }); });
  afterEach(() => { setNativePrintFailureHandler(null); delete (globalThis as unknown as { window?: unknown }).window; });

  it("BT reject with a code → handler gets {code,message,via:bluetooth}; printSlip sync-returns ok (Option A)", async () => {
    withBridge({ printStickerNative: () => Promise.reject(Object.assign(new Error("No Bluetooth printer saved."), { code: "BT_NOT_SET" })) });
    const r = printSlip(buyer(), "NT$", "Shop", btSettings as never);
    expect(r).toEqual({ ok: true, via: "bluetooth" }); // the order flow never sees the async failure
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: "BT_NOT_SET", via: "bluetooth" });
  });

  it("BT resolved {ok:false, code} → forwarded too (both failure shapes)", async () => {
    withBridge({ printStickerNative: () => Promise.resolve({ ok: false, code: "BT_NOT_SET", message: "no printer" }) });
    printSlip(buyer(), "NT$", "Shop", btSettings as never);
    await flush();
    expect(seen[0]).toMatchObject({ code: "BT_NOT_SET", via: "bluetooth" });
  });

  it("LAN sticker reject → via:lan", async () => {
    withBridge({ printStickerLan: () => Promise.reject(Object.assign(new Error("No WiFi printer saved."), { code: "PRINTER_NOT_SET" })) });
    printSlip(buyer(), "NT$", "Shop", lanSettings as never);
    await flush();
    expect(seen[0]).toMatchObject({ code: "PRINTER_NOT_SET", via: "lan" });
  });

  it("no handler registered → no throw (legacy console.warn path)", async () => {
    setNativePrintFailureHandler(null);
    withBridge({ printStickerNative: () => Promise.reject(Object.assign(new Error("x"), { code: "BT_NOT_SET" })) });
    expect(() => printSlip(buyer(), "NT$", "Shop", btSettings as never)).not.toThrow();
    await flush();
  });

  it("batch (Print-screen printAll) → EVERY failing print reports (none silently dropped)", async () => {
    withBridge({ printStickerNative: () => Promise.reject(Object.assign(new Error("no printer"), { code: "BT_NOT_SET" })) });
    for (let i = 0; i < 20; i++) printSlip(buyer(), "NT$", "Shop", btSettings as never); // 20 buyers, no printer
    await flush();
    expect(seen).toHaveLength(20); // each surfaces to the handler; the modal state collapses them to one (see PrinterModal no-stack test)
  });
});

// The SLIP path (sendSlipToNativePrinter) — the pre-existing gap. A rejected
// native printSlip (Android/iOS "No WiFi printer saved" → PRINTER_NOT_SET) must
// reach the modal, mirroring the BT path. These use a handler that mimics
// RedesignApp's real gate (isPrinterNotSetup) so both the no-printer (consumed)
// and other-failure (unconsumed → console.warn) outcomes are proven at the
// integration boundary. Default slip route = printerType "lan" + "receipt".
const slipSettings = { printerType: "lan" as const, lanFormat: "receipt" as const, stickerSize: "100x60" };

describe("printSlip → native SLIP path reject forwarding (no-printer modal)", () => {
  let seen: NativePrintFailure[];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    seen = [];
    // Mirror RedesignApp's handler: consume ONLY the config-missing codes.
    setNativePrintFailureHandler((info) => {
      if (!isPrinterNotSetup(info.code, info.message)) return false;
      seen.push(info); return true;
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { setNativePrintFailureHandler(null); warn.mockRestore(); delete (globalThis as unknown as { window?: unknown }).window; });

  it("no printer → PRINTER_NOT_SET reject reaches the modal {via:native-slip}; sync-returns ok (Option A)", async () => {
    withBridge({ printSlip: () => Promise.reject(Object.assign(new Error("No WiFi printer saved. Enter printer IP and tap Test Connection first."), { code: "PRINTER_NOT_SET" })) });
    const r = printSlip(buyer(), "NT$", "Shop", slipSettings as never);
    expect(r).toEqual({ ok: true, via: "native-slip" }); // order flow never sees the async failure
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: "PRINTER_NOT_SET", via: "native-slip" });
    expect(warn).not.toHaveBeenCalled(); // consumed → no legacy console.warn
  });

  it("genuine failure → PRINT_FAILED reject is NOT modal-consumed (console.warn only, no modal)", async () => {
    withBridge({ printSlip: () => Promise.reject(Object.assign(new Error("Print failed at 1.2.3.4:9100 - timeout"), { code: "PRINT_FAILED" })) });
    printSlip(buyer(), "NT$", "Shop", slipSettings as never);
    await flush();
    expect(seen).toHaveLength(0); // handler returned false → not surfaced as a no-printer modal
    expect(warn).toHaveBeenCalled(); // legacy console.warn path preserved, byte-identical to today
  });

  it("success → resolve {ok:true} → handler never invoked (.catch never runs)", async () => {
    withBridge({ printSlip: () => Promise.resolve({ ok: true, message: "Printed to WiFi printer 1.2.3.4:9100" }) });
    const r = printSlip(buyer(), "NT$", "Shop", slipSettings as never);
    expect(r).toEqual({ ok: true, via: "native-slip" });
    await flush();
    expect(seen).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
