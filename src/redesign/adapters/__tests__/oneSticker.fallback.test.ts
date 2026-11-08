// A PHONE PRINT IS NEVER LOST: the one-sticker picture failing or hanging (a font chunk stuck on a bad
// connection) on the Niimbot / generic / D520 paths prints TODAY's sticker instead, within 8 s, and the
// miss is reported; a saved size wider than the saved printer prints today's sticker and tells the
// seller. Same 8 s limit for the kana font of the all-scripts switch.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ mode: "real" as "real" | "throw" | "hang" | "defer", release: null as null | (() => void) }));
vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  return { ...m, renderOneStickerFor: (...a: Parameters<typeof m.renderOneStickerFor>) => (ctl.mode === "throw" ? Promise.reject(new Error("boom")) : ctl.mode === "hang" ? new Promise(() => {}) : ctl.mode === "defer" ? new Promise((res) => { ctl.release = () => res(m.renderOneStickerFor(...a)); }) : m.renderOneStickerFor(...a)) };
});

import { printSlip, DEF_SETTINGS, setStickerRouteNoticeHandler, setOneStickerNoticeHandler, __resetStuckPicture, ONE_STICKER_PHONE_TIMEOUT_MS, __resetNativePrintQueue, type Settings } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 7, 6, 5);
const buyer = { num: 12, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", totalSpent: 0, totalOrders: 1, orders: [{ orderNum: AT, item: "A2 350", qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name: "Amy Chen", bNum: 12, platform: "TikTok", status: "New", date: "2026-11-07" }] } as unknown as Buyer;
const FN = { d520: "printStickerBitmap", generic: "printRawTspl", niimbot: "printStickerImage" } as const;
type P = keyof typeof FN;

async function capture(path: P, size = "60x40", waitMs = 20000): Promise<string> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async () => ({ ok: true }));
  const br: Record<string, ReturnType<typeof vi.fn>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "generic") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B1-H1", transport: "niimbot" });
  if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  (window as W).SellerFlowPrinter = br;
  const cfg: Settings = { ...DEF_SETTINGS, stickerSize: size, printerType: "bluetooth" };
  printSlip(buyer, "NT$", "My Shop", cfg, { at: AT });
  await vi.waitFor(() => expect(br[FN[path]].mock.calls.length).toBe(1), { timeout: waitMs, interval: 50 });
  const arg = JSON.stringify(br[FN[path]].mock.calls[0][0]);
  delete (window as W).SellerFlowPrinter;
  return arg;
}

const routes: string[] = [];
const sawMiss = (reason: string) => routes.includes(reason);
beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerRouteNoticeHandler((n) => { routes.push(n.reason); }); });
afterEach(() => { __resetStuckPicture(); ctl.release = null; routes.length = 0; ctl.mode = "real"; __resetOneStickerState(); setOneStickerNoticeHandler(null); try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ } });

const optIn = (w = 60, h = 40) => { saveOneSticker(recommendedSettings({ w, h })); setOneStickerVisible(true); };

describe("one sticker — a phone print is never lost", () => {
  it("the picture throws → TODAY's bytes are sent (D520, generic, Niimbot) and the miss is reported", async () => {
    for (const path of ["d520", "generic", "niimbot"] as P[]) {
      const today = await capture(path, path === "niimbot" ? "50x30" : "60x40");
      optIn(path === "niimbot" ? 50 : 60, path === "niimbot" ? 30 : 40);
      const fresh = await capture(path, path === "niimbot" ? "50x30" : "60x40");
      expect(fresh, `${path}: the one sticker really differs`).not.toBe(today);
      ctl.mode = "throw";
      const sent = await capture(path, path === "niimbot" ? "50x30" : "60x40");
      expect(sent, path).toBe(today);
      expect(sawMiss("one-sticker-picture-failed"), path).toBe(true);
      ctl.mode = "real"; __resetOneStickerState(); localStorage.removeItem(LS_ONE_STICKER);
    }
  }, 120000);
  it("the picture hangs (a font never arrives) → today's sticker within 8 s", async () => {
    expect(ONE_STICKER_PHONE_TIMEOUT_MS).toBe(8000);
    const today = await capture("niimbot", "50x30");
    optIn(50, 30);
    ctl.mode = "hang";
    const t0 = Date.now();
    const sent = await capture("niimbot", "50x30", 12000);
    const took = Date.now() - t0;
    expect(sent).toBe(today);
    expect(took).toBeGreaterThanOrEqual(7900);
    expect(took).toBeLessThan(11000);
    expect(sawMiss("one-sticker-picture-failed")).toBe(true);
  }, 30000);
  it("a font stuck on a bad connection costs ONE 8 s wait: the next orders print today's sticker at once (reported once), and the new sticker comes back when it loads", async () => {
    const today = await capture("niimbot", "50x30");
    optIn(50, 30);
    ctl.mode = "defer";
    expect(await capture("niimbot", "50x30", 12000)).toBe(today); // waited 8 s
    const t0 = Date.now();
    expect(await capture("niimbot", "50x30")).toBe(today);
    expect(await capture("niimbot", "50x30")).toBe(today);
    expect(Date.now() - t0, "no 8 s wait while the first picture is still loading").toBeLessThan(3000);
    expect(routes.filter((r) => r === "one-sticker-picture-failed").length, "timeout + one skip report").toBe(2);
    ctl.release!(); await new Promise((r) => setTimeout(r, 50));
    ctl.mode = "real";
    expect(await capture("niimbot", "50x30"), "loaded → the new sticker again").not.toBe(today);
  }, 40000);
  it("a saved size wider than the saved printer (B1 = 50 mm, saved 60×40) → today's sticker + a seller message", async () => {
    const today = await capture("niimbot", "50x30");
    optIn(60, 40);
    const notices: unknown[] = [];
    setOneStickerNoticeHandler((n) => notices.push(n));
    const sent = await capture("niimbot", "50x30");
    expect(sent).toBe(today);
    expect(notices).toEqual([{ kind: "too_wide", model: "B1", maxMm: 50 }]);
    expect(sawMiss("one-sticker-too-wide")).toBe(true);
  }, 60000);
});

import { printOneStickerTest, ONE_STICKER_FALLBACK, ONE_STICKER_TOO_WIDE, __resetWebPrintQueue, BITMAP_SPP_FAILED } from "../printing";
describe("one sticker — laptop and test prints fall back honestly", () => {
  it("laptop: a picture that fails prints today's page AND reports the miss (not only a variable)", async () => {
    delete (window as W).SellerFlowPrinter;
    __resetWebPrintQueue();
    optIn(60, 40);
    ctl.mode = "throw";
    printSlip(buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40" }, { at: AT });
    await vi.waitFor(() => expect(sawMiss("one-sticker-picture-failed")).toBe(true), { timeout: 5000 });
    __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
  });
  it("laptop TEST print: the same fallback, and it says so (ONE_STICKER_FALLBACK)", async () => {
    delete (window as W).SellerFlowPrinter;
    __resetWebPrintQueue();
    ctl.mode = "throw";
    const r = await printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40" });
    expect(r).toMatchObject({ ok: true, code: ONE_STICKER_FALLBACK, via: "browser" });
    expect(sawMiss("one-sticker-picture-failed")).toBe(true);
    __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
  });
  it("phone TEST print whose picture fails: today's test sticker, and it says so", async () => {
    __resetSavedPrinter(); rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    const br = { printStickerNative: vi.fn(async () => ({ ok: true })), printRawTspl: vi.fn(async () => ({ ok: true })) };
    (window as W).SellerFlowPrinter = br;
    ctl.mode = "throw";
    const r = await printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" });
    expect(r).toMatchObject({ ok: true, code: ONE_STICKER_FALLBACK, via: "bluetooth" });
    expect(br.printRawTspl).toHaveBeenCalledTimes(1);
    delete (window as W).SellerFlowPrinter;
  });
  it("TEST print with a size too wide for the printer: today's test sticker, and only the too-wide message (code ONE_STICKER_TOO_WIDE)", async () => {
    __resetSavedPrinter(); rememberSavedPrinter({ address: "AA", name: "B1-H1", transport: "niimbot" });
    const br = { printStickerNative: vi.fn(async (_p: unknown) => ({ ok: true })), printStickerImage: vi.fn(async (_p: unknown) => ({ ok: true })) };
    (window as W).SellerFlowPrinter = br;
    const notices: unknown[] = [];
    setOneStickerNoticeHandler((n) => notices.push(n));
    const r = await printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" });
    expect(r).toMatchObject({ ok: true, code: ONE_STICKER_TOO_WIDE, via: "bluetooth" });
    expect(notices).toHaveLength(1);
    expect(br.printStickerImage).toHaveBeenCalledTimes(1);
    delete (window as W).SellerFlowPrinter;
  });
  it("TEST print falling to the TEXT sticker (SPP send failed) uses the DRAFT's size, not the saved one", async () => {
    __resetSavedPrinter(); rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
    optIn(60, 40); // saved 60×40 …
    const br = { printStickerNative: vi.fn(async (_p: unknown) => ({ ok: true })), printStickerBitmap: vi.fn(async (_p: unknown) => ({ ok: false, code: BITMAP_SPP_FAILED })) };
    (window as W).SellerFlowPrinter = br;
    await printOneStickerTest(recommendedSettings({ w: 80, h: 50 }), buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" }); // … draft 80×50
    expect(br.printStickerNative).toHaveBeenCalledTimes(1);
    expect(br.printStickerNative.mock.calls[0][0]).toMatchObject({ labelWidthMm: 80, labelHeightMm: 50 });
    expect(br.printStickerBitmap, "the new picture once — never today's picture again at the TEXT size").toHaveBeenCalledTimes(1);
    delete (window as W).SellerFlowPrinter;
  });
});

describe("new-screen test print on a TEXT / WiFi phone (audit-2 item 6)", () => {
  it("TEXT phone (no picture method): the TEXT test sticker at the DRAFT's size, not the saved one", async () => {
    __resetSavedPrinter(); __resetNativePrintQueue();
    optIn(60, 40); // saved 60×40
    const br = { printStickerNative: vi.fn(async (_p: unknown) => ({ ok: true })) }; // old app: no picture method → "text"
    (window as W).SellerFlowPrinter = br;
    await printOneStickerTest(recommendedSettings({ w: 80, h: 50 }), buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" });
    await vi.waitFor(() => expect(br.printStickerNative).toHaveBeenCalledTimes(1));
    expect(br.printStickerNative.mock.calls[0][0]).toMatchObject({ labelWidthMm: 80, labelHeightMm: 50 });
    delete (window as W).SellerFlowPrinter;
  });
  it("WiFi sticker phone: the WiFi sticker at the DRAFT's size", async () => {
    __resetSavedPrinter(); __resetNativePrintQueue();
    optIn(60, 40);
    const br = { printStickerLan: vi.fn(async (_p: unknown) => ({ ok: true })) };
    (window as W).SellerFlowPrinter = br;
    await printOneStickerTest(recommendedSettings({ w: 80, h: 50 }), buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "lan", lanFormat: "sticker" });
    await vi.waitFor(() => expect(br.printStickerLan).toHaveBeenCalledTimes(1));
    expect(br.printStickerLan.mock.calls[0][0]).toMatchObject({ labelWidthMm: 80, labelHeightMm: 50 });
    delete (window as W).SellerFlowPrinter;
  });
});

const sampleTest = { ...buyer, num: 128, name: "Maria Santos", handle: "maria_live" } as Buyer;
describe("laptop test print keeps the queue order (audit-2 item 7)", () => {
  it("a test print, then a real order at once: they print in that order (the test joins the queue first)", async () => {
    delete (window as W).SellerFlowPrinter;
    __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
    optIn(60, 40);
    ctl.mode = "defer"; // the test print's picture takes a while
    const written: string[] = [];
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === "iframe") { const f = el as HTMLIFrameElement; const poll = setInterval(() => { const h = f.contentDocument?.documentElement.outerHTML ?? ""; if (h.includes("<body") && h.length > 200 && written[written.length - 1] !== h) written.push(h); if (written.length >= 2) clearInterval(poll); }, 5); }
      return el;
    });
    const test = printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), sampleTest, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40" });
    printSlip(buyer, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40" }, { at: AT }); // a real order right after
    await new Promise((r) => setTimeout(r, 50));
    ctl.mode = "real";
    ctl.release!(); // the test's picture is ready
    expect(await test).toMatchObject({ ok: true, via: "browser" });
    await vi.waitFor(() => expect(written.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    expect(written[0], "the test print is first").toContain("Test sticker");
    expect(written[1]).toContain("Sticker #12");
    spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
  }, 20000);
});
