// Phase 5g — PRINTING adapter (F1 = Option B: COPY + byte-parity test, no App.tsx
// touch). The payload builders below are copied VERBATIM from src/App.tsx and are
// byte-parity-guarded by printing.test.ts. They feed the SAME native bridge methods
// production uses (printStickerNative / printStickerLan / printSlip), so a build that
// runs inside the APK produces byte-identical TSPL/ESC-POS payloads.
//
// ⚠️ DO-NOT-DIVERGE: print geometry / STICKER_LABELS / native payload shape / the
// CJK·GBK·TSS24.BF2 + language-agnostic name handling all live in the NATIVE
// builder (TsplBuilder.java / Swift). This adapter only assembles the JS payload
// those builders consume — copied exactly so the native side is unaffected.
//
// Web / preview (no native bridge) → browser print (hidden iframe + window.print)
// that MIRRORS the native TSPL sticker layout, so 1-Click output matches the APK.
import { shouldUseBluetoothSticker, shouldUseLanSticker } from "../../lib/printerRouting";
import type { Buyer } from "../../lib/orderTypes";
import { rasterizeToBitmapTspl, bytesToBase64 } from "./stickerRaster";
import { LATIN_ATLAS } from "./glyphAtlas.latin";
import { CJK_ATLAS } from "./glyphAtlas.cjk";

// ── Types — copied verbatim from App.tsx:38, 53, 56 ──────────────────────────
export interface Settings {
  darkMode: boolean; autoprint: boolean; soundAlert: boolean; stockAlert: boolean; dailyEmail: boolean; keywords: string; currency: string; paperSize: string; printerType: "auto" | "usb" | "bluetooth" | "lan"; lanFormat: "receipt" | "sticker"; stickerSize: string; printStoreName: boolean; printBuyerNumber: boolean; printBuyerUsername: boolean; printOrderItems: boolean; printTotal: boolean; printAutoClose: boolean; printLogo: boolean; printDateTime: boolean; printBuyerName: boolean; printLabelScale: number; printStoreScale: number; printBuyerNumberScale: number; printBuyerNameScale: number; printUsernameScale: number; printOrderScale: number; printCommentScale: number; printTotalScale: number; printStoreX: number; printStoreY: number; printBuyerLabelX: number; printBuyerLabelY: number; printBuyerNumberX: number; printBuyerNumberY: number; printBuyerNameX: number; printBuyerNameY: number; printUsernameX: number; printUsernameY: number; printSessionX: number; printSessionY: number; printOrderX: number; printOrderY: number; printTotalX: number; printTotalY: number;
}
export interface NativeStickerPayload { storeName: string; sessionDate: string; currency: string; buyer: Buyer; labelWidthMm: number; labelHeightMm: number; settings: Pick<Settings, "printStoreName" | "printBuyerNumber" | "printBuyerUsername" | "printOrderItems" | "printTotal" | "printStoreScale" | "printBuyerNumberScale" | "printBuyerNameScale" | "printUsernameScale" | "printOrderScale" | "printCommentScale" | "printTotalScale">; }
export interface NativePrinterPayload { type: "sellerflow.printSlip"; buyer: Buyer; currency: string; storeName: string; settings: Settings; sessionDate: string; createdAt: string; }

// ── DEF_SETTINGS — copied verbatim from App.tsx:175 ──────────────────────────
export const DEF_SETTINGS: Settings = { darkMode: true, autoprint: true, soundAlert: true, stockAlert: true, dailyEmail: false, keywords: "", currency: "", paperSize: "100x60mm", printerType: "lan", lanFormat: "receipt", stickerSize: "100x60", printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printTotal: true, printAutoClose: true, printLogo: true, printDateTime: true, printBuyerName: true, printLabelScale: 1, printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1, printTotalScale: 1, printStoreX: 0, printStoreY: 0, printBuyerLabelX: 0, printBuyerLabelY: 0, printBuyerNumberX: 0, printBuyerNumberY: 0, printBuyerNameX: 0, printBuyerNameY: 0, printUsernameX: 0, printUsernameY: 0, printSessionX: 0, printSessionY: 0, printOrderX: 0, printOrderY: 0, printTotalX: 0, printTotalY: 0 };

// ── Sticker labels — copied verbatim from App.tsx:519-535 ────────────────────
const STICKER_LABELS: Record<string, { w: number; h: number }> = {
  "100x60": { w: 100, h: 60 },
  "80x60": { w: 80, h: 60 },
  "80x50": { w: 80, h: 50 },
  "70x50": { w: 70, h: 50 },
  "60x40": { w: 60, h: 40 },
};
const STICKER_SIZE_FALLBACK = "100x60";
function stickerSizeKey(size: string | undefined): string {
  const k = (size || "").replace(/mm$/i, "");
  return k in STICKER_LABELS ? k : STICKER_SIZE_FALLBACK;
}
function resolveStickerLabel(size: string | undefined): { w: number; h: number } {
  return STICKER_LABELS[stickerSizeKey(size)];
}

// ── buildNativeStickerPayload — copied VERBATIM from App.tsx:538-585 ──────────
export function buildNativeStickerPayload(buyer: Buyer, cur: string, storeName: string, cfg: Settings): NativeStickerPayload {
  const sessionDate = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const localizedOrders = buyer.orders.map(o => {
    const ts = typeof o.orderNum === "number" ? o.orderNum : 0;
    const time = ts > 1e12
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts))
      : o.time;
    return { ...o, time };
  });
  const label = resolveStickerLabel(cfg.stickerSize);
  return {
    storeName,
    sessionDate,
    currency: cur,
    buyer: { ...buyer, orders: localizedOrders },
    labelWidthMm: label.w,
    labelHeightMm: label.h,
    settings: {
      printStoreName: cfg.printStoreName,
      printBuyerNumber: cfg.printBuyerNumber,
      printBuyerUsername: cfg.printBuyerUsername,
      printOrderItems: cfg.printOrderItems,
      // STICKER-ONLY: Total line permanently removed from the BT sticker on ALL
      // sizes (Jeff). The native TsplBuilder gate is `printTotal && showTotal`, so
      // forcing false here drops "Total:" + amount everywhere. The slip keeps Total
      // (buildSlipPayload passes the full cfg) and production main + the shared
      // native builder are untouched.
      printTotal: false,
      printStoreScale: cfg.printStoreScale,
      printBuyerNumberScale: cfg.printBuyerNumberScale,
      printBuyerNameScale: cfg.printBuyerNameScale,
      printUsernameScale: cfg.printUsernameScale,
      printOrderScale: cfg.printOrderScale,
      printCommentScale: cfg.printCommentScale,
      printTotalScale: cfg.printTotalScale,
    },
  };
}

// ── buildSlipPayload — the NativePrinterPayload from App.tsx:658-659 ──────────
export function buildSlipPayload(buyer: Buyer, cur: string, storeName: string, cfg: Settings): NativePrinterPayload {
  const sess = new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Taipei", month: "long", day: "numeric", year: "numeric" });
  return { type: "sellerflow.printSlip", buyer, currency: cur, storeName, settings: cfg, sessionDate: sess, createdAt: new Date().toISOString() };
}

// F-batch i18n: the ONLY user-visible string this module generates itself (the
// alert fallback when the native bridge reports a failure without a message).
// Default = the verbatim App.tsx copy; RedesignApp overrides it with the
// seller's language whenever the language changes. Native-provided messages
// still pass through untouched.
let nativeFailAlertText = "Native printer failed.";
export function setNativePrintAlertText(text: string): void { if (text) nativeFailAlertText = text; }

// ── No-printer-connected surfacing ───────────────────────────────────────────
// The native bridge fails an order-print SILENTLY today (console.warn for the
// sticker paths; window.alert for the slip path — swallowed by the WebView
// "prevent dialogs" toggle). This lets RedesignApp register ONE handler that
// receives the captured {code, message, via} and shows the "No printer
// connected" modal. printSlip's signature is UNCHANGED — the handler fires from
// the async tail, AFTER the order is already saved (Option A: the sale is never
// lost). If the handler CONSUMES the failure (returns true) the legacy
// console.warn/alert is suppressed; otherwise the old behavior runs unchanged,
// so non-config failure codes (BT_OFF/permission/print-failed/…) are untouched.
export interface NativePrintFailure { code: string; message: string; via: PrintVia; }
let nativePrintFailureHandler: ((info: NativePrintFailure) => boolean) | null = null;
export function setNativePrintFailureHandler(fn: ((info: NativePrintFailure) => boolean) | null): void {
  nativePrintFailureHandler = fn;
}
// Extract {code, message} from either failure shape: a resolved {ok:false,...}
// object OR a Capacitor call.reject error (err.code / err.message).
function readFailure(x: unknown): { code: string; message: string } {
  const o = (x && typeof x === "object" ? x : {}) as { code?: unknown; message?: unknown };
  return { code: typeof o.code === "string" ? o.code : "", message: typeof o.message === "string" ? o.message : "" };
}
// Route a native print failure to the registered handler. Returns true when the
// handler consumed it (caller should skip the legacy console.warn/alert).
function reportNativePrintFailure(via: PrintVia, code: string, message: string): boolean {
  if (!nativePrintFailureHandler) return false;
  try { return nativePrintFailureHandler({ code, message, via }) === true; }
  catch { return false; }
}

// PURE — is this native failure the "no printer set up yet" case (Jeff's two
// triggers: BT no device saved / LAN no IP saved)? Code-first; message-regex
// fallback for older binaries that reject without a code. Every OTHER code
// (BT_NOT_FOUND / BT_OFF / BT_PERMISSION / BT_PRINT_FAILED / BT_BUSY /
// BT_UNAVAILABLE) returns false → keeps its existing behavior. Unit-tested.
const NOT_SETUP_CODES = new Set(["BT_NOT_SET", "PRINTER_NOT_SET"]);
export function isPrinterNotSetup(code: string, message: string): boolean {
  if (code && NOT_SETUP_CODES.has(code)) return true;
  if (code) return false; // a known non-setup code — never guess from the message
  return /no\s+(?:bluetooth\s+)?(?:wifi\s+)?printer\s+saved|enter\s+printer\s+ip|no\s+printer\s+selected/i.test(message || "");
}

// ── Native bridge — copied verbatim from App.tsx:445-451, 475-509, 591-618 ───
function hasNativeMobilePrinter(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    window.SellerFlowPrinter?.printSlip ||
    window.Capacitor?.Plugins?.SellerFlowPrinter?.printSlip ||
    window.ReactNativeWebView?.postMessage
  );
}

function sendSlipToNativePrinter(payload: NativePrinterPayload): boolean {
  if (typeof window === "undefined") return false;
  const showNativePrinterResult = (result: unknown) => {
    void Promise.resolve(result).then((msg) => {
      if (msg && typeof msg === "object") {
        const m = msg as { ok?: boolean; message?: string };
        if (m.ok) return;
        const { code, message } = readFailure(m);
        const text = message || nativeFailAlertText; // F-batch i18n (was hardcoded English)
        if (reportNativePrintFailure("native-slip", code, text)) return; // consumed by the no-printer modal
        console.warn(text);
        window.alert(text);
        return;
      }
      if (typeof msg !== "string" || !msg.trim()) return;
      if (/printed to/i.test(msg)) return;
      if (reportNativePrintFailure("native-slip", "", msg)) return; // consumed by the no-printer modal
      console.warn(msg);
      window.alert(msg);
    }).catch((err) => {
      // A Capacitor call.reject (e.g. Android/iOS printSlip "No WiFi printer
      // saved" → PRINTER_NOT_SET) lands here as a rejection, NOT a resolved
      // {ok:false}. Mirror the BT sticker path (printStickerViaBluetooth) so the
      // no-printer reject reaches the modal; only console.warn when unconsumed.
      const { code, message } = readFailure(err);
      const text = message || nativeFailAlertText;
      if (!reportNativePrintFailure("native-slip", code, text)) console.warn("Native printer bridge failed.", err);
    });
  };
  try {
    if (window.SellerFlowPrinter?.printSlip) { showNativePrinterResult(window.SellerFlowPrinter.printSlip(payload)); return true; }
    if (window.Capacitor?.Plugins?.SellerFlowPrinter?.printSlip) { showNativePrinterResult(window.Capacitor.Plugins.SellerFlowPrinter.printSlip(payload)); return true; }
    if (window.ReactNativeWebView?.postMessage) { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); return true; }
  } catch (err) {
    console.warn("Native printer bridge failed; falling back.", err);
  }
  return false;
}

// ── BITMAP sticker mode (new-board D520BT ROM-font-doubling fix) ─────────────
// Default path when the native `printStickerBitmap` passthrough exists: the whole
// sticker is rasterized in TS (stickerRaster.ts — same layout as the TEXT builder,
// glyphs from the committed atlases) and sent as a finished BITMAP TSPL stream.
// The "Classic text mode" toggle (Printer Settings, per-device localStorage)
// reverts to the byte-frozen TEXT path. METHOD-PRESENCE GATED: binaries without
// the new native method silently keep the TEXT path (safe no-op rollout).
export const LS_CLASSIC_TEXT = "sfl_rd_classic_text";
export function isClassicTextSticker(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(LS_CLASSIC_TEXT) === "1"; } catch { return false; }
}
export function setClassicTextSticker(on: boolean): void {
  try { if (on) localStorage.setItem(LS_CLASSIC_TEXT, "1"); else localStorage.removeItem(LS_CLASSIC_TEXT); } catch { /* ignore */ }
}

// DEV timing instrumentation (Phase-1 speed verification): every sticker print
// logs `[STICKER-TIMING]` to the console (visible in Android Studio Logcat →
// Capacitor/Console) and keeps the last sample on `window.__sflPrintTiming` +
// getLastStickerTiming() for in-app/inspector reads. Negligible overhead — kept
// unconditionally during Phase 1.
export interface StickerTiming { via: "bitmap" | "text"; buildMs: number; bridgeMs: number; totalMs: number; payloadBytes: number; bands: number }
let lastStickerTiming: StickerTiming | null = null;
export const getLastStickerTiming = (): StickerTiming | null => lastStickerTiming;
function recordStickerTiming(t: StickerTiming) {
  lastStickerTiming = t;
  try { (window as unknown as { __sflPrintTiming?: StickerTiming }).__sflPrintTiming = t; } catch { /* ignore */ }
  console.log(`[STICKER-TIMING] via=${t.via} build=${t.buildMs.toFixed(1)}ms bridge=${t.bridgeMs.toFixed(1)}ms total=${t.totalMs.toFixed(1)}ms bytes=${t.payloadBytes} bands=${t.bands}`);
}
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── Route-visibility notice (Phase-1 dev requirement) ────────────────────────
// Every BT sticker print reports WHICH route actually ran (bitmap vs text) and,
// on a text fallback, WHY — so a non-technical owner can see a silent fallback
// in-app (no Logcat). RedesignApp registers one handler (toast); Printer
// Settings reads the last notice. Same registration pattern as
// setNativePrintFailureHandler above.
export type StickerFallbackReason = "" | "classic-mode-on" | "bitmap-method-missing";
export interface StickerRouteNotice { via: "bitmap" | "text"; ok: boolean; reason: StickerFallbackReason; detail: string; payloadBytes: number; totalMs: number }
let stickerRouteNoticeHandler: ((n: StickerRouteNotice) => void) | null = null;
let lastStickerRouteNotice: StickerRouteNotice | null = null;
export function setStickerRouteNoticeHandler(fn: ((n: StickerRouteNotice) => void) | null): void {
  stickerRouteNoticeHandler = fn;
}
export const getLastStickerRouteNotice = (): StickerRouteNotice | null => lastStickerRouteNotice;
function reportStickerRoute(n: StickerRouteNotice): void {
  lastStickerRouteNotice = n;
  try { stickerRouteNoticeHandler?.(n); } catch { /* notice must never break a print */ }
}

// The native passthrough is Android-only until Phase 2 — read it via a local cast
// so the protected App.tsx global Window declaration stays untouched.
//
// ⚠️ TWO probes, deliberately: (1) the MainActivity-injected shim
// (window.SellerFlowPrinter.printStickerBitmap) and (2) Capacitor's OWN
// auto-generated plugin proxy (window.Capacitor.Plugins.SellerFlowPrinter),
// which exposes every @PluginMethod with NO shim involved. The hand-maintained
// shim has now been the missed spot twice (printRawTspl, then a stale-native
// build); probing the Capacitor proxy makes the gate survive a stale shim as
// long as the compiled plugin has the method.
type BitmapBridgeFn = (args: { data: string }) => Promise<{ ok?: boolean; message?: string } | null>;
function bitmapBridgeFn(bridge: NonNullable<Window["SellerFlowPrinter"]>): BitmapBridgeFn | undefined {
  const fn = (bridge as unknown as { printStickerBitmap?: unknown }).printStickerBitmap;
  if (typeof fn === "function") return fn as BitmapBridgeFn;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { SellerFlowPrinter?: { printStickerBitmap?: unknown } } } }).Capacitor;
  const capFn = cap?.Plugins?.SellerFlowPrinter?.printStickerBitmap;
  if (typeof capFn === "function") return (args) => (capFn as BitmapBridgeFn)(args);
  return undefined;
}

async function printStickerViaBitmap(fn: BitmapBridgeFn, buyer: Buyer, cur: string, storeName: string, cfg: Settings): Promise<boolean> {
  const t0 = nowMs();
  const payload = buildNativeStickerPayload(buyer, cur, storeName, cfg);
  const raster = rasterizeToBitmapTspl(payload, payload.labelWidthMm, payload.labelHeightMm, { latin: LATIN_ATLAS, cjk: CJK_ATLAS });
  const data = bytesToBase64(raster.bytes);
  const t1 = nowMs();
  try {
    const result = await fn({ data });
    const t2 = nowMs();
    recordStickerTiming({ via: "bitmap", buildMs: t1 - t0, bridgeMs: t2 - t1, totalMs: t2 - t0, payloadBytes: raster.bytes.length, bands: raster.bands });
    if (result?.ok) {
      reportStickerRoute({ via: "bitmap", ok: true, reason: "", detail: "", payloadBytes: raster.bytes.length, totalMs: t2 - t0 });
      return true;
    }
    const { code, message } = readFailure(result);
    reportStickerRoute({ via: "bitmap", ok: false, reason: "", detail: message || code || "print failed", payloadBytes: raster.bytes.length, totalMs: t2 - t0 });
    if (!reportNativePrintFailure("bluetooth", code, message)) console.warn("[BT bitmap sticker] print failed:", message || "check pairing/selection.");
    return false;
  } catch (err) {
    const { code, message } = readFailure(err);
    reportStickerRoute({ via: "bitmap", ok: false, reason: "", detail: message || code || String(err), payloadBytes: raster.bytes.length, totalMs: nowMs() - t0 });
    if (!reportNativePrintFailure("bluetooth", code, message)) console.warn("printStickerBitmap bridge call failed:", err);
    return false;
  }
}

async function printStickerViaBluetooth(buyer: Buyer, cur: string, storeName: string, cfg: Settings): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (!bridge?.printStickerNative) return false;
  // BITMAP default: fires only when the new native passthrough exists AND the
  // seller hasn't flipped "Classic text mode". Everything else (old binaries,
  // classic mode) takes the UNCHANGED TEXT path below — with the reason recorded
  // so the fallback is VISIBLE in-app, never silent (the Phase-1 field lesson).
  const bmpFn = bitmapBridgeFn(bridge);
  const classic = isClassicTextSticker();
  if (bmpFn && !classic) return printStickerViaBitmap(bmpFn, buyer, cur, storeName, cfg);
  const fallbackReason: StickerFallbackReason = classic ? "classic-mode-on" : "bitmap-method-missing";
  try {
    const t0 = nowMs();
    const result = await bridge.printStickerNative(buildNativeStickerPayload(buyer, cur, storeName, cfg));
    const t1 = nowMs();
    recordStickerTiming({ via: "text", buildMs: 0, bridgeMs: t1 - t0, totalMs: t1 - t0, payloadBytes: 0, bands: 0 });
    reportStickerRoute({ via: "text", ok: !!result?.ok, reason: fallbackReason, detail: result?.ok ? "" : readFailure(result).message, payloadBytes: 0, totalMs: t1 - t0 });
    if (result?.ok) return true;
    const { code, message } = readFailure(result);
    if (!reportNativePrintFailure("bluetooth", code, message)) console.warn("[BT sticker] print failed:", message || "check pairing/selection.");
    return false;
  } catch (err) {
    const { code, message } = readFailure(err);
    reportStickerRoute({ via: "text", ok: false, reason: fallbackReason, detail: message || code || String(err), payloadBytes: 0, totalMs: 0 });
    if (!reportNativePrintFailure("bluetooth", code, message)) console.warn("printStickerNative bridge call failed:", err);
    return false;
  }
}

async function printStickerViaLan(buyer: Buyer, cur: string, storeName: string, cfg: Settings): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (!bridge?.printStickerLan) return false;
  try {
    const result = await bridge.printStickerLan(buildNativeStickerPayload(buyer, cur, storeName, cfg));
    if (result?.ok) return true;
    const { code, message } = readFailure(result);
    if (!reportNativePrintFailure("lan", code, message)) console.warn("[LAN sticker] print failed:", message || "check WiFi printer IP.");
    return false;
  } catch (err) {
    const { code, message } = readFailure(err);
    if (!reportNativePrintFailure("lan", code, message)) console.warn("printStickerLan bridge call failed:", err);
    return false;
  }
}

// HTML-escape (used by the browser-print template below).
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));

// ── Router — mirrors App.tsx printSlip routing (620-704). Native paths fire first
// (BT/iOS-LAN/native-slip via the bridge); on a plain WEB browser (no bridge) it falls
// through to a browser print (hidden iframe + window.print) whose layout MIRRORS the
// native TSPL sticker (Jeff 2026-07-02: one format everywhere). Returns where it went.
export type PrintVia = "bluetooth" | "lan" | "native-slip" | "browser" | "none";
export interface PrintResult { ok: boolean; via: PrintVia; }

export function printSlip(buyer: Buyer, cur: string, storeName: string, printSettings: Settings | string): PrintResult {
  const cfg: Settings = typeof printSettings === "string" ? { ...DEF_SETTINGS, stickerSize: printSettings } : printSettings;
  const nativePrinter = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (shouldUseBluetoothSticker(cfg.printerType, !!nativePrinter?.printStickerNative)) {
    void printStickerViaBluetooth(buyer, cur, storeName, cfg); // failure surfaced inside (no-printer modal or console.warn)
    return { ok: true, via: "bluetooth" };
  }
  if (shouldUseLanSticker(cfg.printerType, cfg.lanFormat, !!nativePrinter?.printStickerLan)) {
    void printStickerViaLan(buyer, cur, storeName, cfg); // failure surfaced inside (no-printer modal or console.warn)
    return { ok: true, via: "lan" };
  }
  const nativePayload = buildSlipPayload(buyer, cur, storeName, cfg);
  if (hasNativeMobilePrinter() && sendSlipToNativePrinter(nativePayload)) return { ok: true, via: "native-slip" };
  // ── WEB FALLBACK: browser print — MIRRORS the native TSPL sticker layout
  // (tsplReference.ts / TsplBuilder tiers), replacing the old 2-column slip
  // (Jeff 2026-07-02: ONE format everywhere). Content parity with the sticker:
  // single column, brand header + Taipei date, dominant Buyer #, name,
  // @username, max 2 order rows with the ENLARGED price code, NO Total
  // (stickers force printTotal off). The browser renders every script natively,
  // so the TSPL-only transliteration/CJK-font tiers don't apply here — raw
  // name/handle text is already correct. Native TSPL/goldens untouched. ──────
  if (typeof document === "undefined") return { ok: false, via: "none" };
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s); // native truncate()
  const lvl = (v: number | undefined) => Math.max(1, Math.min(8, Number(v || 1)));
  const { w: labelW, h: labelH } = resolveStickerLabel(cfg.stickerSize);
  // Height tiers mirror the native SizeConfig tiers (60 / 50 / 40mm). Fonts and
  // gaps are in mm so the layout scales with the physical label; the 40mm tier
  // is compact with a half-height buyer# (native 2x1) — same hierarchy. The
  // 60mm tier's larger gaps approximate the native 100x60 fill-height spread.
  const T = labelH >= 60
    ? { bnum: 9,   name: 5.4, user: 3.8, store: 4.2, brand: 3.6, date: 2.8, time: 2.6, item: 5.4, gap: 2.2, pad: 2.5 }
    : labelH >= 50
      ? { bnum: 8,   name: 4.8, user: 3.4, store: 3.8, brand: 3.4, date: 2.7, time: 2.4, item: 4.8, gap: 1.6, pad: 2.2 }
      : { bnum: 5.2, name: 4,   user: 3,   store: 3.2, brand: 3,   date: 2.4, time: 2.2, item: 4,   gap: 1.1, pad: 1.8 };
  // Taipei date, same source/format family as buildNativeStickerPayload + the
  // native truncate(12) — NOT the old en-PH long date.
  const sess = trunc(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), 12);
  // Max 2 order rows (native maxOrders=2): small time + enlarged price code
  // (font-4 2x-width feel via scaleX), truncated like the native columns.
  const rows = buyer.orders.slice(0, 2).map((o) => `<div class="orow"><span class="otime">${esc(trunc(String(o.time ?? ""), 10))}</span><span class="oitem">${esc(trunc(String(o.item ?? ""), 12))}</span></div>`).join("");
  const frame = document.createElement("iframe");
  frame.title = `Sticker #${buyer.num}`;
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) { frame.remove(); console.warn("Printer was not ready. Try again."); return { ok: false, via: "browser" }; }
  win.onafterprint = () => setTimeout(() => frame.remove(), 50);
  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>Sticker #${esc(buyer.num)}</title><style>@page{size:${labelW}mm ${labelH}mm;margin:${T.pad}mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;width:${labelW - 2 * T.pad}mm;color:#000}.head{display:flex;align-items:flex-end;justify-content:space-between;gap:2mm}.brand{font-size:${T.brand}mm;font-weight:800}.date{font-size:${T.date}mm;font-weight:600}.bar{height:.8mm;background:#000;margin:.8mm 0 ${T.gap}mm}.store{font-size:${T.store * lvl(cfg.printStoreScale)}mm;font-weight:800;margin-bottom:${T.gap}mm}.bnum{font-size:${T.bnum * lvl(cfg.printBuyerNumberScale)}mm;font-weight:900;line-height:1.02;margin-bottom:${T.gap}mm}.name{font-size:${T.name * lvl(cfg.printBuyerNameScale)}mm;font-weight:800;line-height:1.05;margin-bottom:${T.gap}mm;overflow-wrap:anywhere}.user{font-size:${T.user * lvl(cfg.printUsernameScale)}mm;font-weight:700;margin-bottom:${T.gap}mm}.sep{height:.5mm;background:#000;width:65%;margin:${T.gap}mm 0}.orow{display:flex;align-items:baseline;gap:3mm;margin-bottom:${T.gap * 0.7}mm}.otime{font-size:${T.time * lvl(cfg.printOrderScale)}mm;font-weight:600;flex-shrink:0}.oitem{font-size:${T.item * lvl(cfg.printCommentScale)}mm;font-weight:900;display:inline-block;transform:scaleX(1.35);transform-origin:0 50%;white-space:nowrap}@media print{body{margin:0}}</style></head><body>
  <div class="head"><span class="brand">SellerFlowLive</span><span class="date">${esc(sess)}</span></div>
  <div class="bar"></div>
  ${cfg.printStoreName && storeName ? `<div class="store">${esc(trunc(storeName, 36))}</div>` : ""}
  ${cfg.printBuyerNumber ? `<div class="bnum">Buyer ${esc(buyer.num)}</div>` : ""}
  ${buyer.name ? `<div class="name">${esc(trunc(buyer.name, 30))}</div>` : ""}
  ${cfg.printBuyerUsername && buyer.handle ? `<div class="user">@${esc(trunc(buyer.handle.replace(/^@+/, ""), 30))}</div>` : ""}
  ${cfg.printOrderItems && rows ? `<div class="sep"></div>${rows}` : ""}
  </body></html>`);
  doc.close();
  setTimeout(() => {
    win.focus();
    win.print();
    if (cfg.printAutoClose) window.setTimeout(() => frame.remove(), 8000);
  }, 120);
  return { ok: true, via: "browser" };
}

// ── Redesign state → Settings mapper (NEW; not byte-parity-critical). Maps the
// redesign Print-Pattern toggles/sizes + printer settings onto the production
// Settings the payload builders expect. Sizes (0.5–3.0) → integer scale levels
// (1–8) via round+clamp; field toggles map 1:1.
export interface RedesignPrintConfig {
  pp: { shopName: boolean; shopNameSize: number; dateTime: boolean; dateTimeSize: number; buyerNum: boolean; buyerNumSize: number; tiktokName: boolean; tiktokNameSize: number; tiktokUser: boolean; tiktokUserSize: number; comment: boolean; commentSize: number };
  psType: "wifi" | "bt";
  psOut: "receipt" | "sticker";
  psSize: string; // e.g. "100x60mm (Standard)"
}
const lvl = (n: number): number => Math.max(1, Math.min(8, Math.round(n || 1)));
// HONEST-STEPS single source of truth (2026-07-22): the EXACT round+clamp the
// print path applies to every Print-Pattern size multiplier, exported so the
// UI (stepper label + live preview) can display the SAME level that prints —
// preview = print by construction. Pure delegate to `lvl` above; do NOT fork
// or re-implement this mapping anywhere else.
export const printScaleLevel: (n: number) => number = lvl;
const parseStickerSize = (label: string): string => (label.match(/\d+x\d+/)?.[0] || "100x60");

export function buildSettingsFromRedesign(cfg: RedesignPrintConfig): Settings {
  const { pp, psType, psOut, psSize } = cfg;
  return {
    ...DEF_SETTINGS,
    printerType: psType === "bt" ? "bluetooth" : "lan",
    lanFormat: psOut === "sticker" ? "sticker" : "receipt",
    stickerSize: parseStickerSize(psSize),
    printStoreName: pp.shopName,
    printDateTime: pp.dateTime,
    printBuyerNumber: pp.buyerNum,
    printBuyerName: pp.tiktokName,
    printBuyerUsername: pp.tiktokUser,
    printOrderItems: pp.comment,
    printStoreScale: lvl(pp.shopNameSize),
    printBuyerNumberScale: lvl(pp.buyerNumSize),
    printBuyerNameScale: lvl(pp.tiktokNameSize),
    printUsernameScale: lvl(pp.tiktokUserSize),
    // TIME DECOUPLE (Jeff 2026-07-22): printOrderScale drives the ORDER-ROW
    // TIME ("HH:MM", tm in the builders); printCommentScale drives the price
    // code (pm). Both used to map from pp.commentSize, so raising "Comment"
    // also grew/moved the printed time. Time is pinned to base — the builders
    // already treat the two scales separately (native tm/pm + the web-print
    // .otime), so this one line fully decouples them. The price code still
    // tracks the Comment control.
    printOrderScale: 1,
    printCommentScale: lvl(pp.commentSize),
  };
}
