// XP-420B extra blank labels (Jeff 2026-11-09, iPhone → XP-420B 60×40, admin language test): the bytes of every
// job were clean, so the fix is about JOBS. (1) ONE PRINTER LANE — an order, Printer Test and the admin language
// test run one at a time on the phone's printer; before, a test print skipped the queue and could start while an
// order was still printing. (2) FINAL SAFETY — the real bytes are checked right before they are sent; a job that
// is not exactly one label is never sent. (3) The XP-420B command list is today's (no feed / re-sync added).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const bad = vi.hoisted(() => ({ append: "" }));
vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  return { ...m, genericBytes: (...a: Parameters<typeof m.genericBytes>) => { const b = m.genericBytes(...a); if (!bad.append) return b; const tail = new TextEncoder().encode(bad.append); const out = new Uint8Array(b.length + tail.length); out.set(b); out.set(tail, b.length); return out; } };
});
import { printSlip, printOneStickerTest, printStickerBtRouted, onPrinterLane, setStickerQrEntitled, setStickerQrOn, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { recommendedSettings } from "../oneSticker";
import { saveOneSticker, setOneStickerVisible, __resetOneStickerState } from "../oneStickerPrint";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { ADMIN_LANG_SAMPLES, adminSampleBuyer } from "../adminLangSamples";
import { tsplCommands, checkTsplJob, STICKER_JOB_INVALID } from "../stickerJobGuard";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 8, 6, 5);
const cfg: Settings = { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" };
const sample = (k: string) => adminSampleBuyer(ADMIN_LANG_SAMPLES.find((s) => s.key === k)!, AT);
/** A printer bridge whose jobs finish only when the test says so (like the BLE send + settle). */
function slowBridge() {
  const pending: (() => void)[] = [];
  let inFlight = 0, maxInFlight = 0;
  const jobs: Uint8Array[] = [];
  const printRawTspl = vi.fn((a: { data: string }) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    jobs.push(Uint8Array.from(Buffer.from(a.data, "base64")));
    return new Promise((res) => pending.push(() => { inFlight--; res({ ok: true }); }));
  });
  const ok = vi.fn(async () => ({ ok: true }));
  return { bridge: { printRawTspl, printStickerNative: ok, printStickerBitmap: ok }, printRawTspl, pending, jobs, max: () => maxInFlight, finishOne: () => pending.shift()?.() };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(fn: () => boolean, ms = 20000) { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); }

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true); });
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetNativePrintQueue(); __resetSavedPrinter(); __resetOneStickerState(); bad.append = ""; });

describe("one printer lane", () => {
  it("a Printer Test tapped while an ORDER is still printing waits for it — never two jobs on the printer at once (fails on 4244c31b: the test print skipped the queue)", async () => {
    rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    saveOneSticker(recommendedSettings({ w: 60, h: 40 })); setOneStickerVisible(true);
    const b = slowBridge(); (window as W).SellerFlowPrinter = b.bridge;
    printSlip(sample("ko"), "NT$", "My Shop", cfg);                         // the order (queued)
    await until(() => b.printRawTspl.mock.calls.length === 1);
    const test = printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), sample("ar"), "NT$", "My Shop", cfg);
    await new Promise((r) => setTimeout(r, 1500));                            // the test's picture is long ready
    expect(b.printRawTspl.mock.calls.length).toBe(1);                         // …but it waits for the order
    b.finishOne();
    await until(() => b.printRawTspl.mock.calls.length === 2);
    b.finishOne();
    expect((await test).ok).toBe(true);
    expect(b.max()).toBe(1);
    expect(b.jobs.length).toBe(2);
  }, 60000);
  it("the admin language test tapped fast (zh, ja, ko, th, ar, bg, vi): one job at a time, in the order tapped, each sent once", async () => {
    rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    const b = slowBridge(); (window as W).SellerFlowPrinter = b.bridge;
    const keys = ["zh", "ja", "ko", "th", "ar", "bg", "vi"];
    const runs = keys.map((k) => printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), sample(k), "NT$", "My Shop", cfg));
    for (let i = 0; i < keys.length; i++) {
      await until(() => b.printRawTspl.mock.calls.length === i + 1);
      await new Promise((r) => setTimeout(r, 50));
      expect(b.printRawTspl.mock.calls.length, `after ${keys[i]}`).toBe(i + 1);
      b.finishOne();
    }
    for (const r of await Promise.all(runs)) expect(r.ok).toBe(true);
    expect(b.max()).toBe(1);
    expect(b.jobs.length).toBe(keys.length); // never re-sent
  }, 120000);
  it("Printer Settings / Print Pattern test (printStickerBtRouted) shares the lane too", async () => {
    rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    const b = slowBridge(); (window as W).SellerFlowPrinter = b.bridge;
    const one = printStickerBtRouted(sample("en"), "NT$", "My Shop", cfg);
    const two = printStickerBtRouted(sample("vi"), "NT$", "My Shop", cfg);
    await until(() => b.printRawTspl.mock.calls.length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(b.printRawTspl.mock.calls.length).toBe(1);
    b.finishOne();
    await until(() => b.printRawTspl.mock.calls.length === 2);
    b.finishOne();
    expect((await one).ok && (await two).ok).toBe(true);
    expect(b.max()).toBe(1);
  }, 60000);
  it("a job that never settles frees the lane after the watchdog (the next one still prints)", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      void onPrinterLane(() => new Promise<void>(() => { order.push("stuck"); }));
      const next = onPrinterLane(async () => { order.push("next"); return 1; });
      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual(["stuck"]);
      await vi.advanceTimersByTimeAsync(35000);
      expect(await next).toBe(1);
      expect(order).toEqual(["stuck", "next"]);
    } finally { vi.useRealTimers(); }
  });
});

describe("final safety on the real bytes", () => {
  it("a job that is not exactly one label is NEVER sent (an extra FORMFEED after PRINT): the bridge is not called, the print reports a failure", async () => {
    rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    const b = slowBridge(); (window as W).SellerFlowPrinter = b.bridge;
    bad.append = "FORMFEED\r\n";
    const r = await printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), sample("ko"), "NT$", "My Shop", cfg);
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(STICKER_JOB_INVALID);
  }, 60000);
  it("…or a second PRINT 1 (two labels in one job)", async () => {
    rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    const b = slowBridge(); (window as W).SellerFlowPrinter = b.bridge;
    bad.append = "PRINT 1\r\n";
    const r = await printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), sample("ar"), "NT$", "My Shop", cfg);
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(r.code).toBe(STICKER_JOB_INVALID);
  }, 60000);
});

describe("the XP-420B command list", () => {
  it("new sticker = today's sticker, command for command: SIZE · GAP · DIRECTION · REFERENCE · SPEED · DENSITY · CLS · bands · PRINT 1 — no feed / re-sync", async () => {
    const lists: Record<string, string[]> = {};
    for (const route of ["new", "today"] as const) {
      __resetNativePrintQueue(); __resetSavedPrinter();
      rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
      const b = slowBridge(); (window as W).SellerFlowPrinter = b.bridge;
      if (route === "new") void printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), sample("ko"), "NT$", "My Shop", cfg);
      else printSlip(sample("ko"), "NT$", "My Shop", cfg, { noOneSticker: true });
      await until(() => b.jobs.length === 1);
      b.finishOne();
      await flush();
      lists[route] = tsplCommands(b.jobs[0]).cmds.filter((c) => !c.startsWith("BITMAP"));
      expect(checkTsplJob(b.jobs[0], 60, 40), route).toEqual([]);
    }
    expect(lists.new).toEqual(["SIZE 60 mm, 40 mm", "GAP 2 mm, 0", "DIRECTION 1", "REFERENCE 0,0", "SPEED 4", "DENSITY 15", "CLS", "PRINT 1"]);
    expect(lists.today).toEqual(lists.new);
  }, 60000);
});
