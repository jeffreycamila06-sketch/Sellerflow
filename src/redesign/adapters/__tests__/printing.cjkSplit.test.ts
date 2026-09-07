// CJK atlas code-split behavior at the print router:
//   1. ASCII prints never touch the loader (no wait, no chunk dependency).
//   2. A CJK print AWAITS the shared load — the raster is built WITH the atlas
//      (never blank because the chunk was still in flight).
//   3. A FAILED load falls back to the Classic TEXT render for that print with
//      the visible "cjk-atlas-unavailable" reason (never tofu), and the loader
//      contract retries on the next call.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loadCjkAtlasMock = vi.fn();
vi.mock("../cjkAtlasLoader", () => ({
  loadCjkAtlas: (...a: unknown[]) => loadCjkAtlasMock(...a),
  getCjkAtlasSync: () => null,
  prefetchCjkAtlas: () => {},
}));

import { printSlip, setStickerRouteNoticeHandler, DEF_SETTINGS, type Settings, type StickerRouteNotice } from "../printing";
import { buildTestBuyer } from "../printerBridge";
import type { GlyphAtlas } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

// Minimal stand-in for the real (code-split) atlas — one solid 24x24 cell.
const FULL_CELL = Buffer.alloc(72, 0xff).toString("base64");
const CJK_TEST_ATLAS: GlyphAtlas = { cjk: { w: 24, h: 24, glyphs: { 0x9673: FULL_CELL } } };

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
type W = { SellerFlowPrinter?: unknown };

const cjkBuyer = (): Buyer => ({ ...buildTestBuyer(), name: "陳小美" });

describe("CJK atlas code split at the print router", () => {
  beforeEach(() => { loadCjkAtlasMock.mockReset(); });
  afterEach(() => { delete (window as W).SellerFlowPrinter; setStickerRouteNoticeHandler(null); localStorage.clear(); });

  it("ASCII print does NOT call the loader (no wait on the chunk)", async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    printSlip(buildTestBuyer(), "NT$", "Store", cfg);
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(loadCjkAtlasMock).not.toHaveBeenCalled();
  });

  it("CJK print AWAITS the atlas and then prints via bitmap", async () => {
    let release!: (a: unknown) => void;
    loadCjkAtlasMock.mockReturnValue(new Promise((res) => { release = res; }));
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    printSlip(cjkBuyer(), "NT$", "Store", cfg);
    await flush();
    expect(bitmap).not.toHaveBeenCalled(); // still waiting on the chunk
    expect(native).not.toHaveBeenCalled();
    release(CJK_TEST_ATLAS); // chunk arrives
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it("atlas load FAILURE → Classic TEXT fallback for that print, with the visible reason", async () => {
    loadCjkAtlasMock.mockRejectedValue(new Error("offline"));
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    printSlip(cjkBuyer(), "NT$", "Store", cfg);
    await flush();
    expect(bitmap).not.toHaveBeenCalled();
    expect(native).toHaveBeenCalledTimes(1); // TEXT renders the CJK via the printer font — never tofu
    expect(notices[0]).toMatchObject({ via: "text", ok: true, reason: "cjk-atlas-unavailable" });
  });
});
