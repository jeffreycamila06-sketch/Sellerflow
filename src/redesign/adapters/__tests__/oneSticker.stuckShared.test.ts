// ONE "still loading" memory (stuckLoad.ts) for the new-sticker picture, the all-scripts kana wait and
// (all-scripts ON) the Chinese atlas loads of today's image paths: one order never waits 8 s twice,
// and a stuck chunk makes the next waits go on at once until it settles.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ renderHang: false, kanaHang: false, kanaCalls: 0, cjkHang: false, cjkRelease: null as null | (() => void) }));
vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  return { ...m, renderOneStickerFor: (...a: Parameters<typeof m.renderOneStickerFor>) => (ctl.renderHang ? new Promise(() => {}) : m.renderOneStickerFor(...a)) };
});
vi.mock("../oneStickerFonts", async (orig) => {
  const m = await orig<typeof import("../oneStickerFonts")>();
  return { ...m, loadSansFace: (k: Parameters<typeof m.loadSansFace>[0]) => { if (k === "cjkx") ctl.kanaCalls++; return k === "cjkx" && ctl.kanaHang ? new Promise(() => {}) : m.loadSansFace(k); } };
});
vi.mock("../cjkAtlasLoader", async (orig) => {
  const m = await orig<typeof import("../cjkAtlasLoader")>();
  return { ...m, loadCjkAtlas: () => (ctl.cjkHang ? new Promise((res, rej) => { ctl.cjkRelease = () => rej(new Error("late")); }) : m.loadCjkAtlas()) };
});

import { printSlip, DEF_SETTINGS, imagePathAtlases, buildNativeStickerPayload, __resetStuckPicture, __resetNativePrintQueue, type Settings } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { ensureAllScriptsFonts, setStickerAllScripts, ALL_SCRIPTS_FONT_TIMEOUT_MS } from "../oneStickerScripts";
import { withLoadLimit, isLoadStuck, StuckSkip, __resetLoadStuck } from "../stuckLoad";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 7, 6, 5);
const mkBuyer = (name: string, item: string) => ({ num: 12, name, handle: "amy.shop", platform: "TikTok", totalSpent: 0, totalOrders: 1, orders: [{ orderNum: AT, item, qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name, bNum: 12, platform: "TikTok", status: "New", date: "2026-11-07" }] }) as unknown as Buyer;
const kanaPay = { buyer: { name: "田中さん", orders: [{ item: "ワンピース" }] } } as never;

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => {
  vi.useRealTimers(); __resetStuckPicture(); __resetLoadStuck(); setStickerAllScripts(false); __resetOneStickerState();
  ctl.renderHang = ctl.kanaHang = ctl.cjkHang = false; ctl.kanaCalls = 0; ctl.cjkRelease = null;
  try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ }
  delete (window as W).SellerFlowPrinter;
});

describe("one shared stuck memory", () => {
  it("the kana wait timed out → the next new-sticker picture is skipped at once (first skip reported)", async () => {
    vi.useFakeTimers();
    setStickerAllScripts(true); ctl.kanaHang = true;
    const p = ensureAllScriptsFonts(kanaPay);
    await vi.advanceTimersByTimeAsync(ALL_SCRIPTS_FONT_TIMEOUT_MS);
    await p;
    expect(isLoadStuck()).toBe(true);
    const make = vi.fn(async () => 1);
    await expect(withLoadLimit(make, 8000, true)).rejects.toSatisfy((e) => e instanceof StuckSkip && e.first);
    await expect(withLoadLimit(make, 8000, true)).rejects.toSatisfy((e) => e instanceof StuckSkip && !e.first);
    expect(make).not.toHaveBeenCalled();
  });
  it("the picture timed out → a kana print does not wait again (the kana font is not even asked for)", async () => {
    vi.useFakeTimers();
    setStickerAllScripts(true);
    const pic = withLoadLimit(() => new Promise(() => {}), 8000, true).catch(() => "skipped");
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pic).toBe("skipped");
    ctl.kanaHang = true; ctl.kanaCalls = 0;
    let done = false;
    void ensureAllScriptsFonts(kanaPay).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(ctl.kanaCalls).toBe(0);
  });
  it("the memory clears when the stuck load settles (the next wait is a normal one again)", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const slow = new Promise<void>((res) => { release = res; });
    const first = withLoadLimit(() => slow, 8000).catch(() => "late");
    await vi.advanceTimersByTimeAsync(8000);
    expect(await first).toBe("late");
    expect(isLoadStuck()).toBe(true);
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(isLoadStuck()).toBe(false);
    expect(await withLoadLimit(async () => 7, 8000)).toBe(7);
  });

  it("a kana order on a SAVED device with a stuck chunk waits 8 s ONCE (picture → today's sticker → no second kana wait)", async () => {
    setStickerAllScripts(true);
    saveOneSticker(recommendedSettings({ w: 50, h: 30 })); setOneStickerVisible(true);
    ctl.renderHang = true; ctl.kanaHang = true;
    __resetNativePrintQueue(); __resetSavedPrinter();
    rememberSavedPrinter({ address: "AA", name: "B1-H1", transport: "niimbot" });
    const br = { printStickerNative: vi.fn(async () => ({ ok: true })), printStickerImage: vi.fn(async () => ({ ok: true })) };
    (window as W).SellerFlowPrinter = br;
    const t0 = Date.now();
    printSlip(mkBuyer("田中さん", "ワンピース 350"), "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "50x30", printerType: "bluetooth" } as Settings, { at: AT });
    await vi.waitFor(() => expect(br.printStickerImage.mock.calls.length).toBe(1), { timeout: 20000, interval: 50 });
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(7900);
    expect(took, "one 8 s wait, never 16 s").toBeLessThan(12000);
  }, 30000);
});

describe("all-scripts ON: today's image paths wait on the Chinese atlas at most 8 s", () => {
  const zhPayload = () => buildNativeStickerPayload(mkBuyer("陳小美", "A2 350"), "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "80x60" } as Settings, AT);
  it("ON + a stuck Chinese chunk → the atlases come back after 8 s (no Chinese atlas; the next print does not wait)", async () => {
    vi.useFakeTimers();
    setStickerAllScripts(true); ctl.cjkHang = true;
    const pay = zhPayload();
    let got: unknown = null;
    void imagePathAtlases(pay, { buyer: { name: "陳小美", orders: [{ item: "A2 350" }] } } as never).then((a) => { got = a; });
    await vi.advanceTimersByTimeAsync(ALL_SCRIPTS_FONT_TIMEOUT_MS - 10);
    expect(got).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(got).not.toBeNull();
    expect(isLoadStuck()).toBe(true);
    let again: unknown = null;
    void imagePathAtlases(pay, { buyer: { name: "陳小美", orders: [{ item: "A2 350" }] } } as never).then((a) => { again = a; });
    await vi.advanceTimersByTimeAsync(1);
    expect(again, "already stuck → at once").not.toBeNull();
  });
  it("OFF → exactly today's wait (no limit: still waiting after 20 s)", async () => {
    vi.useFakeTimers();
    ctl.cjkHang = true;
    let got: unknown = null;
    void imagePathAtlases(zhPayload(), { buyer: { name: "陳小美", orders: [{ item: "A2 350" }] } } as never).then((a) => { got = a; });
    await vi.advanceTimersByTimeAsync(20000);
    expect(got).toBeNull();
    expect(isLoadStuck()).toBe(false);
    ctl.cjkRelease?.(); await vi.advanceTimersByTimeAsync(0);
  });
});
