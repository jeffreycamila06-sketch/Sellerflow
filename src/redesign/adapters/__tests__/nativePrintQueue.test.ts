// NATIVE STICKER PRINT QUEUE (phone BT/LAN) — the AIMO burst fix. printSlip's
// native branch used to fire `void printStickerViaBluetooth/Lan` per order → N
// concurrent bridge calls → the native single-flight BLE transport rejects the
// overlaps with BT_BUSY → stickers dropped silently. These tests pin the fix:
// ONE native print at a time (the next starts only after the prior settles, never
// concurrently), a rejecting/failed job fires the not-printed outcome AND advances,
// a wedged bridge is bounded by the watchdog, and the web queue path is untouched.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { printSlip, setNativePrintOutcomeHandler, setNativePrintFailureHandler, __resetNativePrintQueue, DEF_SETTINGS } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const btCfg = { ...DEF_SETTINGS, printerType: "bluetooth" as const };
const lanCfg = { ...DEF_SETTINGS, printerType: "lan" as const, lanFormat: "sticker" as const };
const buyer = (num: number, orderNum: number): Buyer => ({
  handle: "@ann", name: "Ann", platform: "TikTok", num, totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum, item: "A1", qty: 1, price: 100, total: 100, time: "10:00", handle: "@ann", name: "Ann", bNum: num, platform: "TikTok", status: "", date: "2026-09-17" }],
});
const tick = () => new Promise((r) => setTimeout(r, 0));
type W = typeof globalThis & { window: { SellerFlowPrinter?: unknown } };
const setBridge = (b: unknown) => { (globalThis as W).window.SellerFlowPrinter = b; };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { __resetNativePrintQueue(); setNativePrintOutcomeHandler(null); setNativePrintFailureHandler(null); warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { __resetNativePrintQueue(); setNativePrintOutcomeHandler(null); setNativePrintFailureHandler(null); delete (globalThis as W).window.SellerFlowPrinter; warn.mockRestore(); vi.useRealTimers(); });

describe("native print queue — serialized single-flight runner", () => {
  it("burst of 10 → prints ONE at a time, NEVER concurrent (the next starts only after the prior settles)", async () => {
    let inFlight = 0, maxInFlight = 0;
    const pending: Array<() => void> = [];
    const printStickerNative = vi.fn(() => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => { pending.push(() => { inFlight--; resolve({ ok: true }); }); });
    });
    setBridge({ printStickerNative }); // no printStickerBitmap → the plain TEXT bridge path

    for (let i = 1; i <= 10; i++) printSlip(buyer(i, 1000 + i), "NT$", "Shop", btCfg);
    await tick();
    expect(printStickerNative).toHaveBeenCalledTimes(1); // only job 1 dispatched; 2-10 queued

    for (let i = 0; i < 10; i++) {
      expect(pending.length).toBe(1);   // exactly one bridge call in flight at any moment
      pending.shift()!();               // complete the current print
      await tick();                     // → the queue advances to the next
    }
    expect(printStickerNative).toHaveBeenCalledTimes(10); // all 10 eventually printed
    expect(maxInFlight).toBe(1);        // the single-flight invariant held throughout (no BT_BUSY overlap)
  });

  it("a job that REJECTS → not-printed outcome fired (mapped to its orderNum) AND the queue advances", async () => {
    setBridge({ printStickerNative: vi.fn(() => Promise.reject(Object.assign(new Error("busy"), { code: "BT_BUSY" }))) });
    const outcomes: Array<{ id: string; ok: boolean }> = [];
    setNativePrintOutcomeHandler((id, ok) => outcomes.push({ id, ok }));

    printSlip(buyer(1, 555), "NT$", "Shop", btCfg);
    printSlip(buyer(2, 556), "NT$", "Shop", btCfg);
    await tick(); await tick();

    // BOTH jobs report not-printed (none silently dropped) → the queue did not stall on the first failure.
    expect(outcomes).toEqual([{ id: "555", ok: false }, { id: "556", ok: false }]);
  });

  it("a SUCCESSFUL job → outcome ok=true for its orderNum", async () => {
    setBridge({ printStickerNative: vi.fn(() => Promise.resolve({ ok: true })) });
    const outcomes: Array<{ id: string; ok: boolean }> = [];
    setNativePrintOutcomeHandler((id, ok) => outcomes.push({ id, ok }));
    printSlip(buyer(1, 42), "NT$", "Shop", btCfg);
    await tick(); await tick();
    expect(outcomes).toEqual([{ id: "42", ok: true }]);
  });

  it("watchdog: a WEDGED bridge (never settles) → not-printed + advance, so the queue can't freeze", async () => {
    vi.useFakeTimers();
    const printStickerNative = vi.fn(() => new Promise(() => {})); // never resolves/rejects
    setBridge({ printStickerNative });
    const outcomes: Array<{ id: string; ok: boolean }> = [];
    setNativePrintOutcomeHandler((id, ok) => outcomes.push({ id, ok }));

    printSlip(buyer(1, 777), "NT$", "Shop", btCfg);
    printSlip(buyer(2, 778), "NT$", "Shop", btCfg);
    await vi.advanceTimersByTimeAsync(0);
    expect(printStickerNative).toHaveBeenCalledTimes(1); // job 2 held while job 1 hangs

    await vi.advanceTimersByTimeAsync(35000); // job 1 watchdog fires → not-printed → advance
    expect(outcomes[0]).toEqual({ id: "777", ok: false });
    expect(printStickerNative).toHaveBeenCalledTimes(2); // job 2 now dispatched

    await vi.advanceTimersByTimeAsync(35000); // job 2 watchdog
    expect(outcomes[1]).toEqual({ id: "778", ok: false });
  });

  it("LAN sticker path is serialized on the SAME queue", async () => {
    let inFlight = 0, maxInFlight = 0;
    const pending: Array<() => void> = [];
    const printStickerLan = vi.fn(() => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => { pending.push(() => { inFlight--; resolve({ ok: true }); }); });
    });
    setBridge({ printStickerLan });
    for (let i = 1; i <= 5; i++) printSlip(buyer(i, 2000 + i), "NT$", "Shop", lanCfg);
    await tick();
    expect(printStickerLan).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) { pending.shift()!(); await tick(); }
    expect(printStickerLan).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(1);
  });

  it("web queue path is untouched: no native bridge → printSlip takes the browser path, native queue idle", async () => {
    setBridge(undefined); // no SellerFlowPrinter → shouldUseBluetoothSticker/Lan both false
    const outcomes: Array<{ id: string; ok: boolean }> = [];
    setNativePrintOutcomeHandler((id, ok) => outcomes.push({ id, ok }));
    const r = printSlip(buyer(1, 99), "NT$", "Shop", btCfg); // bt requested but no bridge → web fallback
    expect(r.via).toBe("browser");         // fell through to the web/browser print, not the native queue
    await tick();
    expect(outcomes).toHaveLength(0);       // the native outcome channel never fired
    document.querySelectorAll("iframe").forEach((f) => f.remove()); // clean up the web print iframe
  });
});
