// Router branch + "Classic text mode" toggle + method-presence gating for the
// BITMAP sticker path. The three contractual behaviors:
//   1. bitmap DEFAULT: bridge has printStickerBitmap + toggle off → the bitmap
//      passthrough gets the pre-built TSPL (base64), TEXT path NOT called.
//   2. classic toggle ON → the unchanged TEXT path (printStickerNative) fires.
//   3. OLD BINARY (no printStickerBitmap) → TEXT path fires (safe no-op rollout).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printSlip, printStickerBtRouted, isClassicTextSticker, setClassicTextSticker, setClassicTextAllowed, canUseClassicText, setStickerRouteNoticeHandler, getLastStickerRouteNotice, LS_CLASSIC_TEXT, DEF_SETTINGS, getLastStickerTiming, type Settings, type StickerRouteNotice } from "../printing";
import { buildTestBuyer } from "../printerBridge";

const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
const buyer = buildTestBuyer();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

type W = { SellerFlowPrinter?: unknown; Capacitor?: unknown };

describe("printSlip bitmap routing", () => {
  beforeEach(() => { localStorage.removeItem(LS_CLASSIC_TEXT); });
  afterEach(() => {
    delete (window as W).SellerFlowPrinter;
    delete (window as W).Capacitor;
    localStorage.removeItem(LS_CLASSIC_TEXT);
    setStickerRouteNoticeHandler(null);
    setClassicTextAllowed(false); // module default (regular seller / pre-auth)
  });

  it("default = BITMAP when the native passthrough exists (TEXT not called)", async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
    // the passthrough receives the SDK-format stream (manufacturer protocol):
    // "SIZE 100 mm,60 mm" (no space after comma), DIRECTION 0,0, one LZO-
    // compressed BITMAP mode-4 block, tail "\r\nPRINT 1,1\n\r".
    const arg = bitmap.mock.calls[0][0] as { data: string };
    const bytes = Buffer.from(arg.data, "base64");
    expect(bytes.slice(0, 17).toString("ascii")).toBe("SIZE 100 mm,60 mm");
    expect(bytes.includes(Buffer.from("DIRECTION 0,0"))).toBe(true);
    expect(bytes.includes(Buffer.from("BITMAP 4,0,100,480,4,"))).toBe(true);
    expect(bytes.slice(-11).toString("ascii")).toBe("\r\nPRINT 1,1\n\r".slice(-11));
    // and NO TEXT commands — the whole point (new-board ROM fonts bypassed)
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);
    // timing instrumentation recorded the bitmap send
    expect(getLastStickerTiming()?.via).toBe("bitmap");
    expect(getLastStickerTiming()?.payloadBytes).toBe(bytes.length);
  });

  it("Classic text mode ON (allowed user) → the unchanged TEXT path fires", async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    setClassicTextAllowed(true); // admin/test account signed in
    setClassicTextSticker(true);
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
    expect(bitmap).not.toHaveBeenCalled();
  });

  it("old binary (no printStickerBitmap) → TEXT path (method-presence gate)", async () => {
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("bitmap reject with BT_NOT_SET routes through the no-printer failure handler", async () => {
    const bitmap = vi.fn().mockRejectedValue({ code: "BT_NOT_SET", message: "No Bluetooth printer saved." });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r.via).toBe("bluetooth");
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("STALE-SHIM HARDENING: shim method absent but Capacitor.Plugins proxy has it → BITMAP still fires", async () => {
    // The MainActivity-injected shim missed a method twice (printRawTspl, then a
    // stale native build). Capacitor's auto-generated Plugins proxy exposes every
    // @PluginMethod with no shim — the gate must find it there as a second probe.
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native }; // stale shim: no printStickerBitmap
    (window as W).Capacitor = { Plugins: { SellerFlowPrinter: { printStickerBitmap: bitmap } } };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, via: "bluetooth" });
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it("ROUTE NOTICE: bitmap success reports via/ok/bytes to the registered handler", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(notices).toHaveLength(1);
    expect(notices[0].via).toBe("bitmap");
    expect(notices[0].ok).toBe(true);
    expect(notices[0].payloadBytes).toBeGreaterThan(0);
    expect(getLastStickerRouteNotice()).toEqual(notices[0]);
  });

  it("ROUTE NOTICE: method-missing fallback reports TEXT + reason bitmap-method-missing", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native }; // no bitmap method anywhere
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ via: "text", ok: true, reason: "bitmap-method-missing" });
  });

  it("ROUTE NOTICE: classic-mode fallback reports TEXT + reason classic-mode-on", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: vi.fn() };
    setClassicTextAllowed(true);
    setClassicTextSticker(true);
    printSlip(buyer, "NT$", "Store", cfg);
    await flush();
    expect(native).toHaveBeenCalledTimes(1);
    expect(notices[0]).toMatchObject({ via: "text", ok: true, reason: "classic-mode-on" });
  });

  it("ROUTE NOTICE: a throwing handler never breaks the print", async () => {
    setStickerRouteNoticeHandler(() => { throw new Error("boom"); });
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    const r = printSlip(buyer, "NT$", "Store", cfg);
    expect(r.ok).toBe(true);
    await flush();
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(getLastStickerRouteNotice()?.via).toBe("bitmap"); // recorded despite the throw
  });

  // ---- printStickerBtRouted: the awaitable entry the Test Print buttons use.
  // Same router as printSlip's fire-and-forget call — these pin the RESULT shape
  // the buttons map to user messages (ok → sent; BT_NOT_SET → no-printer modal
  // wording; anything else → failed).

  it("ROUTED ENTRY: resolves {ok:true} via BITMAP by default (TEXT not called)", async () => {
    const notices: StickerRouteNotice[] = [];
    setStickerRouteNoticeHandler((n) => notices.push(n));
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    const r = await printStickerBtRouted(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, code: "", message: "" });
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
    expect(notices[0]).toMatchObject({ via: "bitmap", ok: true }); // route notice fires for Test Print too
  });

  it("ROUTED ENTRY: BT_NOT_SET reject surfaces code+message in the result", async () => {
    const bitmap = vi.fn().mockRejectedValue({ code: "BT_NOT_SET", message: "No Bluetooth printer saved." });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await printStickerBtRouted(buyer, "NT$", "Store", cfg);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BT_NOT_SET"); // the buttons key isPrinterNotSetup off this
    warn.mockRestore();
  });

  it("ROUTED ENTRY: Classic mode ON (allowed) → TEXT path, result still {ok:true}", async () => {
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    setClassicTextAllowed(true);
    setClassicTextSticker(true);
    const r = await printStickerBtRouted(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: true, code: "", message: "" });
    expect(native).toHaveBeenCalledTimes(1);
    expect(bitmap).not.toHaveBeenCalled();
  });

  it("ROUTED ENTRY: no bridge at all → {ok:false} with empty code (web no-op)", async () => {
    const r = await printStickerBtRouted(buyer, "NT$", "Store", cfg);
    expect(r).toEqual({ ok: false, code: "", message: "" });
  });

  // ---- Classic-toggle VISIBILITY gate (owner rule: admin + test account only).

  it("SAFETY: stray sfl_rd_classic_text=1 on a NON-allowed user's device → BITMAP anyway", async () => {
    // e.g. an admin flipped the toggle while logged in on a seller's phone, then
    // logged out — the router must ignore the flag for users who can't see the
    // toggle, or the seller is stuck on the doubling TEXT path with no visible way out.
    const bitmap = vi.fn().mockResolvedValue({ ok: true });
    const native = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    setClassicTextSticker(true); // flag present on the device…
    // …but setClassicTextAllowed(false) (the afterEach default = regular seller)
    const r = await printStickerBtRouted(buyer, "NT$", "Store", cfg);
    expect(r.ok).toBe(true);
    expect(bitmap).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it("canUseClassicText: admin role (both casings) + test accounts YES, regular seller NO", () => {
    expect(canUseClassicText("admin", "seller@x.com")).toBe(true); // db-cased role
    expect(canUseClassicText("Admin", "seller@x.com")).toBe(true); // display-cased role
    expect(canUseClassicText("seller", "googletest@sellerflowlive.com")).toBe(true); // the real test account
    expect(canUseClassicText("seller", "GoogleTest@SellerFlowLive.com")).toBe(true); // case-insensitive
    expect(canUseClassicText("seller", "googletest@gmail.com")).toBe(true); // owner-specified spelling
    expect(canUseClassicText("seller", "maria@example.com")).toBe(false);
    expect(canUseClassicText("Seller", "kylerkao@example.com")).toBe(false);
    expect(canUseClassicText(undefined, undefined)).toBe(false); // pre-auth / logged out
    expect(canUseClassicText(null, null)).toBe(false);
  });

  it("toggle helpers round-trip via localStorage", () => {
    expect(isClassicTextSticker()).toBe(false);
    setClassicTextSticker(true);
    expect(localStorage.getItem(LS_CLASSIC_TEXT)).toBe("1");
    expect(isClassicTextSticker()).toBe(true);
    setClassicTextSticker(false);
    expect(localStorage.getItem(LS_CLASSIC_TEXT)).toBe(null);
    expect(isClassicTextSticker()).toBe(false);
  });
});
