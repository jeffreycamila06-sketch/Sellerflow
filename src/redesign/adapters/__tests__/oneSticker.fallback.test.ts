// A PHONE PRINT IS NEVER LOST: the one-sticker picture failing or hanging (a font chunk stuck on a bad
// connection) on the Niimbot / generic / D520 paths prints TODAY's sticker instead, within 8 s, and the
// miss is reported; a saved size wider than the saved printer prints today's sticker and tells the
// seller. Same 8 s limit for the kana font of the all-scripts switch.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ mode: "real" as "real" | "throw" | "hang" }));
vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  return { ...m, renderOneStickerFor: (...a: Parameters<typeof m.renderOneStickerFor>) => (ctl.mode === "throw" ? Promise.reject(new Error("boom")) : ctl.mode === "hang" ? new Promise(() => {}) : m.renderOneStickerFor(...a)) };
});

import { printSlip, DEF_SETTINGS, setStickerRouteNoticeHandler, setOneStickerNoticeHandler, ONE_STICKER_PHONE_TIMEOUT_MS, __resetNativePrintQueue, type Settings } from "../printing";
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
afterEach(() => { routes.length = 0; ctl.mode = "real"; __resetOneStickerState(); setOneStickerNoticeHandler(null); try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ } });

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
