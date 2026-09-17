// WEB PRINT QUEUE (laptop / no native bridge) — the serialized print runner.
// Auto Mode used to hang the browser under a burst: N concurrent iframes + N
// blocking win.print() calls stacked. These tests pin the fix: ONE reusable
// iframe, ONE print at a time (advance on onafterprint OR a 4s fallback), held
// while the tab is hidden, and a one-time kiosk hint when the first job never
// confirms. jsdom has no window.SellerFlowPrinter, so printSlip always takes the
// browser fallback here.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { printSlip, setWebPrintOutcomeHandler, setWebPrintKioskHintHandler, __resetWebPrintQueue, DEF_SETTINGS } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const cfg = DEF_SETTINGS;
const buyer = (num: number, orderNum: number): Buyer => ({
  handle: "@ann", name: "Ann", platform: "TikTok", num, totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum, item: "A1", qty: 1, price: 100, total: 100, time: "10:00", handle: "@ann", name: "Ann", bNum: num, platform: "TikTok", status: "", date: "2026-09-16" }],
});
const theFrame = () => document.querySelector("iframe") as HTMLIFrameElement | null;
// Spy the (single, reused) iframe's print; optionally auto-fire onafterprint to
// simulate a completed/dismissed print (kiosk success).
const spyPrint = (autoAfterPrint: boolean) => {
  const win = theFrame()!.contentWindow!;
  return vi.spyOn(win, "print").mockImplementation(() => { if (autoAfterPrint) win.onafterprint?.(new Event("afterprint")); });
};

describe("web print queue — serialized single-iframe runner", () => {
  beforeEach(() => { __resetWebPrintQueue(); setWebPrintOutcomeHandler(null); setWebPrintKioskHintHandler(null); vi.useFakeTimers(); });
  afterEach(() => {
    __resetWebPrintQueue(); setWebPrintOutcomeHandler(null); setWebPrintKioskHintHandler(null);
    vi.useRealTimers(); vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((f) => f.remove());
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  it("burst of 20 → exactly 20 sequential prints through ONE reused iframe (no hang)", () => {
    for (let i = 1; i <= 20; i++) printSlip(buyer(i, 1000 + i), "NT$", "Shop", cfg);
    expect(document.querySelectorAll("iframe").length).toBe(1); // single reusable iframe, not 20
    const printSpy = spyPrint(true); // each print immediately fires afterprint → next job
    vi.advanceTimersByTime(120 * 25); // 20 jobs × 120ms serialization delay, drained in order
    expect(printSpy).toHaveBeenCalledTimes(20);
    expect(document.querySelectorAll("iframe").length).toBe(1); // still one
  });

  it("never a second win.print() while one is pending (isPrinting guard)", () => {
    printSlip(buyer(1, 1), "NT$", "Shop", cfg);
    printSlip(buyer(2, 2), "NT$", "Shop", cfg);
    const printSpy = spyPrint(false); // job 1 never confirms (silent kiosk)
    vi.advanceTimersByTime(60);
    expect(printSpy).toHaveBeenCalledTimes(1); // job 2 held until job 1 advances
    vi.advanceTimersByTime(1300); // job 1 advance-only timer → job 2 starts
    vi.advanceTimersByTime(60);
    expect(printSpy).toHaveBeenCalledTimes(2);
  });

  it("a single print (manual 1-Click parity) prints exactly once via the browser path", () => {
    const r = printSlip(buyer(1, 1), "NT$", "Shop", cfg);
    expect(r).toEqual({ ok: true, via: "browser" });
    const printSpy = spyPrint(false);
    vi.advanceTimersByTime(120);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("onafterprint never fires (silent kiosk) → advances the queue WITHOUT reporting not-printed", () => {
    const outcome = vi.fn();
    setWebPrintOutcomeHandler(outcome);
    printSlip(buyer(1, 777), "NT$", "Shop", cfg);
    spyPrint(false); // no afterprint — but the print DID happen
    vi.advanceTimersByTime(60);
    expect(outcome).not.toHaveBeenCalled();
    // advance-only timer fires → the queue can move on, but NO false not-printed badge
    vi.advanceTimersByTime(1300);
    expect(outcome).not.toHaveBeenCalled();
    // a NEXT job still drains (queue advanced)
    printSlip(buyer(2, 778), "NT$", "Shop", cfg);
    expect(theFrame()).not.toBeNull();
  });

  it("a REAL failure (win.print throws) → reports NOT printed immediately", () => {
    const outcome = vi.fn();
    setWebPrintOutcomeHandler(outcome);
    printSlip(buyer(1, 900), "NT$", "Shop", cfg);
    vi.spyOn(theFrame()!.contentWindow!, "print").mockImplementation(() => { throw new Error("boom"); });
    vi.advanceTimersByTime(60); // print() runs (~40ms) → throws → settle(false)
    expect(outcome).toHaveBeenCalledWith("900", false);
  });

  it("reports ok=true (printed) when onafterprint confirms", () => {
    const outcome = vi.fn();
    setWebPrintOutcomeHandler(outcome);
    printSlip(buyer(1, 42), "NT$", "Shop", cfg);
    spyPrint(true);
    vi.advanceTimersByTime(120);
    expect(outcome).toHaveBeenCalledWith("42", true);
    expect(outcome).toHaveBeenCalledTimes(1);
  });

  it("holds the queue while the tab is hidden; drains on visibilitychange (no focus theft)", () => {
    const hidden = { v: true };
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden.v });
    printSlip(buyer(1, 5), "NT$", "Shop", cfg);
    vi.advanceTimersByTime(500);
    expect(theFrame()).toBeNull(); // held — the job never STARTED, so no iframe/print yet
    hidden.v = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(theFrame()).not.toBeNull(); // drained → job started
    const printSpy = spyPrint(true);
    vi.advanceTimersByTime(120);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("fires the kiosk hint ONCE when the first job isn't confirmed within the hint window", () => {
    const kiosk = vi.fn();
    setWebPrintKioskHintHandler(kiosk);
    printSlip(buyer(1, 9), "NT$", "Shop", cfg);
    spyPrint(false); // never confirms → dialog likely open
    vi.advanceTimersByTime(6000);
    expect(kiosk).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000); // once per session — no re-fire
    expect(kiosk).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the kiosk hint when the first job confirms via onafterprint", () => {
    const kiosk = vi.fn();
    setWebPrintKioskHintHandler(kiosk);
    printSlip(buyer(1, 3), "NT$", "Shop", cfg);
    spyPrint(true); // confirms immediately → kiosk active
    vi.advanceTimersByTime(120);
    vi.advanceTimersByTime(6000);
    expect(kiosk).not.toHaveBeenCalled();
  });
});
