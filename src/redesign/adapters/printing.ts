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
import { isAdminRole } from "../../lib/roles";
import type { Buyer } from "../../lib/orderTypes";
import { rasterizeToSdkBitmapTspl, bytesToBase64, payloadNeedsCjk, QR_QUIET_MODULES, type GlyphAtlas } from "./stickerRaster";
import { qrMatrix } from "../../lib/qr";
import { tiktokProfileUrl } from "../../lib/tiktokHandle";
import { loadCjkAtlas } from "./cjkAtlasLoader";
import { LATIN_ATLAS } from "./glyphAtlas.latin";

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

// ── "Print QR on sticker" toggle — per-device, DEFAULT OFF ────────────────────
// Stamps a QR of the buyer @username on the bitmap sticker (bottom-right) so Parcel
// Scan can read the handle back off the physical label (the handle is purged from the
// free-tier DB). localStorage only (per-device UI pref, sfl_rd_* convention — no DB, no
// migration). Read at payload-build time → threaded into the raster settings, which stamp
// the QR ONLY when this is true. A missing/other value = OFF (safe rollout: nothing
// changes for any seller until they flip it on). BITMAP path only — TEXT-path prints
// (old binaries / Classic mode) carry no QR regardless.
export const LS_STICKER_QR = "sfl_rd_sticker_qr";
export function isStickerQrOn(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(LS_STICKER_QR) === "1"; } catch { return false; }
}
export function setStickerQrOn(on: boolean): void {
  try { if (on) localStorage.setItem(LS_STICKER_QR, "1"); else localStorage.removeItem(LS_STICKER_QR); } catch { /* ignore */ }
}

// ENTITLEMENT — the QR is on ALL plans; only the market gate applies (canUseStickerQr in
// parcelScan.ts). This module flag is the PRINT-TIME gate: RedesignApp sets it when the
// profile resolves; the sticker path ANDs it with isStickerQrOn(). DEFAULT false
// (FAIL-CLOSED) so a stored toggle off-market (or before the profile loads) NEVER prints a
// QR. No plan/market logic lives here — just the on/off flag.
let stickerQrEntitled = false;
export function setStickerQrEntitled(on: boolean): void { stickerQrEntitled = on === true; }
export function isStickerQrEntitled(): boolean { return stickerQrEntitled; }
// The print-time truth: a QR stamps ONLY when the per-device toggle is on AND the account
// is entitled (Plus/Pro/Master+admin). This is the single gate the sticker path reads.
export function stickerQrEffective(): boolean { return isStickerQrOn() && stickerQrEntitled; }

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

// ── Classic-toggle VISIBILITY gate (owner requirement, pre-merge) ────────────
// The toggle is a debugging/fallback instrument: a curious seller flipping it on
// a new-board printer gets doubled output and thinks the app broke. So it is
// visible ONLY to admin-role accounts (the app-wide isAdminRole predicate,
// lib/roles.ts — same source of truth as the Admin screen gate) and the test
// account. SAFER-BEHAVIOR RULE: the ROUTER honors the localStorage flag only
// while the toggle would be visible to the CURRENT user (setClassicTextAllowed,
// synced from auth by RedesignApp). A stray sfl_rd_classic_text=1 left on a
// seller's device (e.g. set while an admin was logged in there) is therefore
// IGNORED — the print routes bitmap regardless. Default DISALLOWED (pre-auth /
// logged out / rollback contexts route bitmap, the correct path).
// AUDIT F4: ONLY the owner-controlled documented test account. Never add an
// unowned/registrable address here — registration is open, so a listed email
// is a grantable backdoor to the toggle.
const CLASSIC_TEXT_TEST_ACCOUNTS = new Set(["googletest@sellerflowlive.com"]);
export function canUseClassicText(role: string | undefined | null, email: string | undefined | null): boolean {
  if (isAdminRole(role)) return true;
  return CLASSIC_TEXT_TEST_ACCOUNTS.has(String(email || "").trim().toLowerCase());
}
let classicTextAllowed = false;
export function setClassicTextAllowed(allowed: boolean): void { classicTextAllowed = allowed; }

// Internal timing instrumentation (console-only, NEVER surfaced in UI): every
// sticker print logs `[STICKER-TIMING]` to the console (Logcat → Capacitor/
// Console) and keeps the last sample on `window.__sflPrintTiming` +
// getLastStickerTiming() for inspector/support reads. Negligible overhead.
export interface StickerTiming { via: "bitmap" | "text"; buildMs: number; bridgeMs: number; totalMs: number; payloadBytes: number; bands: number }
let lastStickerTiming: StickerTiming | null = null;
export const getLastStickerTiming = (): StickerTiming | null => lastStickerTiming;
function recordStickerTiming(t: StickerTiming) {
  lastStickerTiming = t;
  try { (window as unknown as { __sflPrintTiming?: StickerTiming }).__sflPrintTiming = t; } catch { /* ignore */ }
  console.log(`[STICKER-TIMING] via=${t.via} build=${t.buildMs.toFixed(1)}ms bridge=${t.bridgeMs.toFixed(1)}ms total=${t.totalMs.toFixed(1)}ms bytes=${t.payloadBytes} bands=${t.bands}`);
}
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── Route-visibility notice (INTERNAL instrumentation — no UI consumer) ──────
// Every BT sticker print records WHICH route actually ran (bitmap vs text) and,
// on a text fallback, WHY. The seller-facing toast + "Last print" readout that
// consumed this during the bitmap bring-up were REMOVED pre-merge (owner
// decision); the hooks stay because the test suite pins the routing/fallback
// reasons through them, and support can read getLastStickerRouteNotice() /
// window.__sflPrintTiming from an inspector. Genuine print FAILURES surface to
// sellers via setNativePrintFailureHandler above (unchanged) — never via this.
export type StickerFallbackReason = "" | "classic-mode-on" | "bitmap-method-missing" | "cjk-atlas-unavailable" | "bitmap-spp-failed";
// AUDIT F2 safety net: the native reject code for an SPP-transport bitmap send
// that failed at the socket level — the router retries that print through the
// unchanged TEXT path, so an SPP-incompatible unit degrades to today's behavior.
export const BITMAP_SPP_FAILED = "BITMAP_SPP_FAILED";
// `phase` (bitmap only): the native transport's own breakdown — "conn 0.6s send
// 3.4s done 0.5s chunk 20x365" — so a slow print says WHERE the time went
// (GATT connect vs BLE transfer vs printer processing) and the negotiated chunk
// size (chunk 20 = MTU negotiation failed = the 7KB-in-5s failure mode).
export interface StickerRouteNotice { via: "bitmap" | "text"; ok: boolean; reason: StickerFallbackReason; detail: string; payloadBytes: number; totalMs: number; phase?: string }
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
type BitmapBridgeResult = { ok?: boolean; message?: string; chunk?: number; chunks?: number; connectMs?: number; writeMs?: number; doneMs?: number } | null;
type BitmapBridgeFn = (args: { data: string }) => Promise<BitmapBridgeResult>;

// Format the native JobStats fields (when the binary is new enough to send
// them) into the human phase string shown in the toast / Last-print line.
function formatBitmapPhase(r: BitmapBridgeResult): string {
  if (!r || typeof r.connectMs !== "number") return "";
  const sec = (ms?: number) => `${((ms ?? 0) / 1000).toFixed(1)}s`;
  const chunk = typeof r.chunk === "number" && r.chunk > 0 ? ` chunk ${r.chunk}x${r.chunks ?? "?"}` : "";
  return `conn ${sec(r.connectMs)} send ${sec(r.writeMs)} done ${sec(r.doneMs)}${chunk}`;
}
/**
 * True only when THIS binary can actually print the bitmap stream (the native
 * printStickerBitmap method exists via the shim or the Capacitor proxy).
 * Gates the CJK-atlas prefetch: binaries that can only TEXT-print (all
 * pre-bitmap releases, iOS until Phase 2) never download the ~836KB chunk.
 */
export function hasBitmapStickerMethod(): boolean {
  const bridge = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  return !!bridge && !!bitmapBridgeFn(bridge);
}
function bitmapBridgeFn(bridge: NonNullable<Window["SellerFlowPrinter"]>): BitmapBridgeFn | undefined {
  const fn = (bridge as unknown as { printStickerBitmap?: unknown }).printStickerBitmap;
  if (typeof fn === "function") return fn as BitmapBridgeFn;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { SellerFlowPrinter?: { printStickerBitmap?: unknown } } } }).Capacitor;
  const capFn = cap?.Plugins?.SellerFlowPrinter?.printStickerBitmap;
  if (typeof capFn === "function") return (args) => (capFn as BitmapBridgeFn)(args);
  return undefined;
}

// Outcome of a routed BT sticker print — code/message preserved so callers
// (the Test Print buttons) can keep their precise user messaging (BT_NOT_SET
// -> the no-printer wording) while inheriting the bitmap-default routing.
export interface BtRouteResult { ok: boolean; code: string; message: string }

async function printStickerViaBitmap(fn: BitmapBridgeFn, payload: NativeStickerPayload, cjk: GlyphAtlas): Promise<BtRouteResult> {
  const t0 = nowMs();
  // SDK-format image stream (manufacturer protocol — vendor/QY_Android_SDK.zip):
  // one LZO-compressed full-label BITMAP mode-4 block, the firmware's native
  // image engine (the Labelife path — clean + fast on BOTH boards). The legacy
  // mode-0 band emission (rasterizeToBitmapTspl) stays golden-tested but dormant.
  // The CJK atlas arrives RESOLVED (code-split chunk; the caller awaited it
  // only when the payload actually contains CJK).
  // QR is a bitmap-only concern (the native TSPL text builders can't render it), so
  // the "Print QR on sticker" toggle enters HERE, not in the byte-parity native payload.
  const qrPayload = { ...payload, settings: { ...payload.settings, printStickerQr: stickerQrEffective() } };
  const raster = rasterizeToSdkBitmapTspl(qrPayload, payload.labelWidthMm, payload.labelHeightMm, { latin: LATIN_ATLAS, cjk });
  const data = bytesToBase64(raster.bytes);
  const t1 = nowMs();
  try {
    const result = await fn({ data });
    const t2 = nowMs();
    const phase = formatBitmapPhase(result);
    recordStickerTiming({ via: "bitmap", buildMs: t1 - t0, bridgeMs: t2 - t1, totalMs: t2 - t0, payloadBytes: raster.bytes.length, bands: raster.bands });
    if (phase) console.log(`[STICKER-TIMING] native ${phase}`);
    if (result?.ok) {
      reportStickerRoute({ via: "bitmap", ok: true, reason: "", detail: "", payloadBytes: raster.bytes.length, totalMs: t2 - t0, phase });
      return { ok: true, code: "", message: "" };
    }
    const { code, message } = readFailure(result);
    reportStickerRoute({ via: "bitmap", ok: false, reason: "", detail: message || code || "print failed", payloadBytes: raster.bytes.length, totalMs: t2 - t0, phase });
    // BITMAP_SPP_FAILED is not surfaced here — the caller retries via TEXT,
    // which reports its own outcome (no double modal/warn for one print).
    if (code !== BITMAP_SPP_FAILED && !reportNativePrintFailure("bluetooth", code, message)) console.warn("[BT bitmap sticker] print failed:", message || "check pairing/selection.");
    return { ok: false, code, message };
  } catch (err) {
    const { code, message } = readFailure(err);
    reportStickerRoute({ via: "bitmap", ok: false, reason: "", detail: message || code || String(err), payloadBytes: raster.bytes.length, totalMs: nowMs() - t0 });
    if (code !== BITMAP_SPP_FAILED && !reportNativePrintFailure("bluetooth", code, message)) console.warn("printStickerBitmap bridge call failed:", err);
    return { ok: false, code, message };
  }
}

async function printStickerViaBluetooth(buyer: Buyer, cur: string, storeName: string, cfg: Settings): Promise<BtRouteResult> {
  const bridge = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (!bridge?.printStickerNative) return { ok: false, code: "", message: "" };
  // BITMAP default: fires only when the new native passthrough exists AND the
  // seller hasn't flipped "Classic text mode". Everything else (old binaries,
  // classic mode) takes the UNCHANGED TEXT path below — with the reason recorded
  // so the fallback is VISIBLE in-app, never silent (the Phase-1 field lesson).
  const bmpFn = bitmapBridgeFn(bridge);
  // Visibility-gated: the flag only counts for users who can SEE the toggle
  // (admin/test account — see canUseClassicText above). Everyone else routes
  // bitmap even with a stray localStorage flag on the device.
  const classic = classicTextAllowed && isClassicTextSticker();
  let cjkUnavailable = false;
  let sppFailed = false;
  if (bmpFn && !classic) {
    const payload = buildNativeStickerPayload(buyer, cur, storeName, cfg);
    // The CJK atlas is a code-split chunk (prefetched at app start on bridge
    // devices). ASCII/Latin prints never wait on it; a CJK print awaits the
    // SAME promise the prefetch started. If the chunk can't load (offline cold
    // open), THIS print falls through to the Classic TEXT render (readable CJK
    // via the printer font — never tofu); the next print retries the chunk load.
    let cjk: GlyphAtlas | null = {};
    if (payloadNeedsCjk(payload)) {
      try { cjk = await loadCjkAtlas(); } catch { cjk = null; cjkUnavailable = true; }
    }
    if (cjk) {
      const r = await printStickerViaBitmap(bmpFn, payload, cjk);
      // AUDIT F2: native says the SPP-transport bitmap send failed at the
      // socket level → retry THIS print through the unchanged TEXT path below.
      // Every other outcome (success, or a real print failure) returns as-is.
      if (r.ok || r.code !== BITMAP_SPP_FAILED) return r;
      sppFailed = true;
    }
  }
  const fallbackReason: StickerFallbackReason = classic ? "classic-mode-on" : cjkUnavailable ? "cjk-atlas-unavailable" : sppFailed ? "bitmap-spp-failed" : "bitmap-method-missing";
  try {
    const t0 = nowMs();
    const result = await bridge.printStickerNative(buildNativeStickerPayload(buyer, cur, storeName, cfg));
    const t1 = nowMs();
    recordStickerTiming({ via: "text", buildMs: 0, bridgeMs: t1 - t0, totalMs: t1 - t0, payloadBytes: 0, bands: 0 });
    reportStickerRoute({ via: "text", ok: !!result?.ok, reason: fallbackReason, detail: result?.ok ? "" : readFailure(result).message, payloadBytes: 0, totalMs: t1 - t0 });
    if (result?.ok) return { ok: true, code: "", message: "" };
    const { code, message } = readFailure(result);
    if (!reportNativePrintFailure("bluetooth", code, message)) console.warn("[BT sticker] print failed:", message || "check pairing/selection.");
    return { ok: false, code, message };
  } catch (err) {
    const { code, message } = readFailure(err);
    reportStickerRoute({ via: "text", ok: false, reason: fallbackReason, detail: message || code || String(err), payloadBytes: 0, totalMs: 0 });
    if (!reportNativePrintFailure("bluetooth", code, message)) console.warn("printStickerNative bridge call failed:", err);
    return { ok: false, code, message };
  }
}

// EVERY BT sticker entry point routes through this (owner requirement): real
// orders via printSlip below, and the Test Print buttons (Printer Settings +
// Print Pattern) directly — bitmap SDK stream by default, TEXT only on Classic
// mode / missing method / CJK-atlas-unavailable, route notices always firing.
// Awaitable with the native {code, message} preserved for button messaging.
export const printStickerBtRouted = printStickerViaBluetooth;

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

// ── WEB PRINT QUEUE (laptop / no native bridge) ──────────────────────────────
// The web fallback prints via a hidden iframe + window.print(). window.print()
// BLOCKS the main thread until the print job is spooled (or, without a kiosk
// flag, until the modal dialog is dismissed). Under Auto Mode a burst of orders
// used to fire N concurrent iframes + N blocking win.print() calls → stacked
// dialogs = frozen browser; missed prints were silent; per-order iframes leaked.
//
// This module serializes ALL web prints through ONE reusable hidden iframe:
//   • printSlip's web path ENQUEUES {id, html} and returns immediately;
//   • a runner prints ONE job at a time — never a second win.print() while one
//     is pending (webBusy guard) — advancing only on `onafterprint` OR a 4s
//     fallback if that event never fires;
//   • the queue is HELD while the tab is hidden (no background-tab timer
//     throttling reordering prints, no win.focus() theft) and drained on
//     visibilitychange;
//   • the single iframe is REUSED (rewritten per job) and never removed per
//     order — nothing to leak, no 8s cleanup race;
//   • each job's outcome (printed / not-printed) is reported to an optional
//     subscriber so the caller can badge a "not printed" order + offer reprint;
//   • the FIRST job of a session arms a kiosk-hint timer: if `onafterprint`
//     doesn't confirm within KIOSK_HINT_MS, the print dialog is likely open
//     (kiosk mode not active) → a one-time guidance notice fires.
// Native BT/LAN/TSPL paths are untouched; this affects ONLY the browser path.
interface WebPrintJob { id: string; html: string; }
const WEB_PRINT_DELAY_MS = 40;           // brief settle before print() (was 120 — trimmed)
const WEB_ADVANCE_MS = 1300;             // advance the queue after this if onafterprint never fires (silent kiosk) — WITHOUT marking not-printed
const WEB_KIOSK_HINT_MS = 6000;          // first job unconfirmed by now ⇒ dialog likely open
let webQueue: WebPrintJob[] = [];
let webBusy = false;
let webFrame: HTMLIFrameElement | null = null;
let webSeq = 0;             // monotonic id assigned when a job STARTS
let webFallbackId = 0;      // fallback synthetic job-id counter (jobs with no orderNum)
let firstJobSeq = 0;        // seq of the session's first web job (0 = none yet)
let firstJobConfirmed = false;
let kioskHintFired = false;
let webAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
let webKioskTimer: ReturnType<typeof setTimeout> | null = null;
let webVisBound = false;

// Job outcome (printed=true / not-printed=false), keyed by the job id the caller
// supplied via the printed buyer's orderNum. Optional — web-only.
let webOutcomeHandler: ((id: string, ok: boolean) => void) | null = null;
export function setWebPrintOutcomeHandler(fn: ((id: string, ok: boolean) => void) | null): void { webOutcomeHandler = fn; }
// Fired ONCE per session when the first job's onafterprint doesn't arrive in
// time (kiosk likely inactive). The caller shows a dismissible setup notice.
let webKioskHintHandler: (() => void) | null = null;
export function setWebPrintKioskHintHandler(fn: (() => void) | null): void { webKioskHintHandler = fn; }

function ensureWebFrame(): HTMLIFrameElement | null {
  if (typeof document === "undefined") return null;
  if (webFrame && webFrame.isConnected) return webFrame;
  const f = document.createElement("iframe");
  f.title = "Print";
  f.setAttribute("aria-hidden", "true");
  f.style.position = "fixed";
  f.style.right = "0";
  f.style.bottom = "0";
  f.style.width = "0";
  f.style.height = "0";
  f.style.border = "0";
  f.style.opacity = "0";
  document.body.appendChild(f);
  webFrame = f;
  return f;
}

function ensureWebVisibilityListener(): void {
  if (webVisBound || typeof document === "undefined") return;
  webVisBound = true;
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pumpWebQueue(); });
}

function pumpWebQueue(): void {
  if (webBusy || !webQueue.length) return;
  if (typeof document !== "undefined" && document.hidden) return; // HELD until visible again
  const job = webQueue.shift()!;
  webBusy = true;
  startWebJob(job);
}

function startWebJob(job: WebPrintJob): void {
  const seq = ++webSeq;
  if (!firstJobSeq) firstJobSeq = seq;
  let settled = false;   // an OUTCOME (ok / not-printed) was reported
  let advanced = false;  // the queue moved on to the next job
  // Free the queue for the next job WITHOUT reporting an outcome. Used by the
  // short timer for a silent kiosk (onafterprint never fires but the print DID
  // happen) — so bursts flow AND no false "Not printed" badge appears.
  const advance = () => {
    if (advanced) return;
    advanced = true;
    if (webAdvanceTimer) { clearTimeout(webAdvanceTimer); webAdvanceTimer = null; }
    webBusy = false;
    pumpWebQueue(); // drain the next job in order
  };
  // Report the outcome (onafterprint = printed ok; a real failure = not printed)
  // AND advance. A silent kiosk reports NOTHING (advance-only above) → no badge.
  const settle = (ok: boolean) => {
    if (settled) return;
    settled = true;
    try { webOutcomeHandler?.(job.id, ok); } catch { /* subscriber must never break the queue */ }
    advance();
  };
  const confirmFirstJob = () => {
    if (seq !== firstJobSeq || firstJobConfirmed) return;
    firstJobConfirmed = true;
    if (webKioskTimer) { clearTimeout(webKioskTimer); webKioskTimer = null; }
  };
  const frame = ensureWebFrame();
  const win = frame?.contentWindow;
  if (!win) { settle(false); return; } // no iframe → REAL failure → NOT printed (reported)
  const doc = win.document;
  try { doc.open(); doc.write(job.html); doc.close(); }
  catch { settle(false); return; }     // write threw → REAL failure → NOT printed
  // onafterprint = positive confirmation (real print completed / dialog dismissed).
  // A stale afterprint from a previous job that reused this frame is harmless: it
  // settles the CURRENT job as ok and only confirms the kiosk check on job 1.
  win.onafterprint = () => { confirmFirstJob(); settle(true); };
  // Kiosk detection: arm only for the session's first job. If onafterprint hasn't
  // confirmed by KIOSK_HINT_MS, the dialog is likely open (kiosk not active).
  if (seq === firstJobSeq && !kioskHintFired) {
    if (webKioskTimer) clearTimeout(webKioskTimer);
    webKioskTimer = setTimeout(() => {
      webKioskTimer = null;
      if (!firstJobConfirmed && !kioskHintFired) { kioskHintFired = true; try { webKioskHintHandler?.(); } catch { /* noop */ } }
    }, WEB_KIOSK_HINT_MS);
  }
  // ADVANCE-ONLY fallback (decoupled from the outcome): if onafterprint never
  // fires (many silent-kiosk drivers don't), move to the next job after a short
  // wait so bursts drain — but do NOT mark this job "not printed" (it printed).
  // A REAL failure above reports not-printed immediately; this path never does.
  webAdvanceTimer = setTimeout(advance, WEB_ADVANCE_MS);
  setTimeout(() => {
    try {
      if (typeof document === "undefined" || !document.hidden) win.focus(); // never steal focus from a hidden tab
      win.print();
    } catch { settle(false); }         // print threw → REAL failure → NOT printed
  }, WEB_PRINT_DELAY_MS);
}

function enqueueWebPrint(job: WebPrintJob): void {
  ensureWebVisibilityListener();
  webQueue.push(job);
  pumpWebQueue();
}

// Test-only: reset all module queue state (state persists across a module's
// lifetime by design, so tests reset between cases).
export function __resetWebPrintQueue(): void {
  webQueue = [];
  webBusy = false;
  if (webAdvanceTimer) { clearTimeout(webAdvanceTimer); webAdvanceTimer = null; }
  if (webKioskTimer) { clearTimeout(webKioskTimer); webKioskTimer = null; }
  if (webFrame && webFrame.isConnected) webFrame.remove();
  webFrame = null;
  webSeq = 0;
  webFallbackId = 0;
  firstJobSeq = 0;
  firstJobConfirmed = false;
  kioskHintFired = false;
}

// ── NATIVE STICKER PRINT QUEUE (phone BT/LAN) ─────────────────────────────────
// AIMO burst fix (native twin of the web queue above). printSlip's BT/LAN branches
// used to fire `void printStickerViaBluetooth/Lan(...)` PER ORDER → N concurrent
// bridge calls → the native single-flight BLE transport rejects the overlaps with
// BT_BUSY → stickers dropped silently (only a console.warn). Serialize them here:
// ONE native print at a time, awaiting printStickerViaBluetooth/Lan to COMPLETION
// (resolve OR reject) before the next. The bridge promise resolves only on true
// native completion — BLE FF03 PRINTING:DONE / Classic-SPP drain+close — so serial
// awaiting is real end-to-end backpressure and the BT_BUSY overlap can never occur.
// BT and LAN share ONE queue (both contend for the single printer). The ESC/POS
// SLIP path (sendSlipToNativePrinter, a different printer) is a SEPARATE lane and is
// intentionally NOT queued here. Payload bytes + the Capacitor plugin are UNTOUCHED
// — only WHEN JS calls the existing bridge changes.
type NativeStickerVia = "bluetooth" | "lan";
interface NativeStickerJob { via: NativeStickerVia; buyer: Buyer; cur: string; storeName: string; cfg: Settings; jobId: string; }
// ABOVE the native BLE overall cap (~30s) so a genuinely wedged bridge (a promise
// that never settles) can't freeze the queue — on timeout we mark not-printed and
// advance. The native side self-bounds well under this in every normal case, so the
// watchdog is a pure safety backstop, never the primary completion signal.
const NATIVE_PRINT_WATCHDOG_MS = 35000;
let nativeQueue: NativeStickerJob[] = [];
let nativeBusy = false;
let nativeFallbackId = 0; // synthetic job-id for a buyer with no orderNum (won't map to a row)

// Job outcome (printed=true / not-printed=false), keyed by the SAME id the web queue
// uses (the order's orderNum) → RedesignApp badges the not-printed row + offers
// reprint via the identical channel. Registered by RedesignApp alongside the web one.
let nativeOutcomeHandler: ((id: string, ok: boolean) => void) | null = null;
export function setNativePrintOutcomeHandler(fn: ((id: string, ok: boolean) => void) | null): void { nativeOutcomeHandler = fn; }

// The job id correlates the async print outcome back to the order row — identical
// derivation to the web path (buyer.orders[0].orderNum). A synthetic buyer with no
// order gets a fallback id that simply won't map to a row (no badge, harmless).
function nativeStickerJobId(buyer: Buyer): string {
  return String(buyer.orders?.[0]?.orderNum ?? `native-${++nativeFallbackId}`);
}

function enqueueNativeSticker(job: NativeStickerJob): void {
  nativeQueue.push(job);
  void pumpNativeQueue();
}

async function pumpNativeQueue(): Promise<void> {
  if (nativeBusy || !nativeQueue.length) return;
  nativeBusy = true;
  const job = nativeQueue.shift()!;
  const ok = await runNativeStickerJob(job);
  try { nativeOutcomeHandler?.(job.jobId, ok); } catch { /* subscriber must never break the queue */ }
  nativeBusy = false;
  void pumpNativeQueue(); // drain the next job in order
}

// Run ONE native print to completion, returning printed(true)/not-printed(false).
// printStickerViaBluetooth/Lan already catch internally; the outer try + watchdog
// guarantee this always settles so the queue never wedges.
async function runNativeStickerJob(job: NativeStickerJob): Promise<boolean> {
  try {
    const run: Promise<BtRouteResult | boolean> = job.via === "bluetooth"
      ? printStickerViaBluetooth(job.buyer, job.cur, job.storeName, job.cfg)
      : printStickerViaLan(job.buyer, job.cur, job.storeName, job.cfg);
    // WATCHDOG: race the print against a timer ABOVE the native cap. The winner is
    // almost always the print (BT resolves {ok}; LAN resolves boolean); a genuine
    // hang loses to the timer → not-printed → advance. The timer is cleared the
    // moment the print settles, so a normal print leaves nothing pending. `ok` is
    // computed inside the .then (where the result is typed) so the race yields a
    // plain boolean-or-timeout.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const printed = run.then((r): { done: true; ok: boolean } => ({ done: true, ok: typeof r === "boolean" ? r : !!r?.ok }));
    const watchdog = new Promise<{ done: false }>((res) => { timer = setTimeout(() => res({ done: false }), NATIVE_PRINT_WATCHDOG_MS); });
    try {
      const outcome = await Promise.race([printed, watchdog]);
      return outcome.done ? outcome.ok : false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch { return false; } // never let a stray throw wedge the queue
}

// Test-only: reset the native queue state between cases.
export function __resetNativePrintQueue(): void { nativeQueue = []; nativeBusy = false; nativeFallbackId = 0; }

// WEB STICKER QR — the browser-print twin of the phone's stickerQrPlacement: the SAME
// link (tiktokProfileUrl), the SAME ECC "M", drawn as an inline SVG (crisp vector
// squares) with the same 4-module quiet zone. Each module is 0.5 mm = the phone's
// 4 dots at 203 dpi, so a typical handle (QR v3, 29 modules) is an 18.5 mm block.
// NO label-size check on web: the seller's own browser/printer-driver settings decide
// the paper size (the phone path keeps its own 60×40 exclusion). null = no QR.
export const WEB_QR_MODULE_MM = 0.5;
export function webStickerQrSvg(handle: string | undefined | null): { svg: string; sizeMm: number } | null {
  const h = String(handle ?? "").trim();
  if (!h) return null;
  const url = tiktokProfileUrl(h);
  if (!url) return null;
  const m = qrMatrix(url, "M");
  if (!m) return null;
  const q = QR_QUIET_MODULES, n = m.length, total = n + 2 * q;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  const svg = `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  return { svg, sizeMm: total * WEB_QR_MODULE_MM };
}

export function printSlip(buyer: Buyer, cur: string, storeName: string, printSettings: Settings | string): PrintResult {
  const cfg: Settings = typeof printSettings === "string" ? { ...DEF_SETTINGS, stickerSize: printSettings } : printSettings;
  const nativePrinter = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (shouldUseBluetoothSticker(cfg.printerType, !!nativePrinter?.printStickerNative)) {
    // SERIALIZED (AIMO burst fix): enqueue instead of firing concurrently. The queue
    // awaits each print to native completion before the next → no BT_BUSY overlap
    // drops. Return contract unchanged (enqueue succeeded). Failure/not-printed is
    // surfaced by the queue (no-printer modal + the not-printed reprint channel).
    enqueueNativeSticker({ via: "bluetooth", buyer, cur, storeName, cfg, jobId: nativeStickerJobId(buyer) });
    return { ok: true, via: "bluetooth" };
  }
  if (shouldUseLanSticker(cfg.printerType, cfg.lanFormat, !!nativePrinter?.printStickerLan)) {
    // SERIALIZED with the BT lane (same single printer) — see enqueueNativeSticker.
    enqueueNativeSticker({ via: "lan", buyer, cur, storeName, cfg, jobId: nativeStickerJobId(buyer) });
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
  // The job id lets the caller correlate the async print outcome back to the
  // order (buyer.orders[0].orderNum = the order's unique epoch-ms id). Missing
  // (e.g. a synthetic buyer) → a fallback id that simply won't map to a row.
  const jobId = String(buyer.orders?.[0]?.orderNum ?? `web-${++webFallbackId}`);
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s); // native truncate()
  // Taipei date, same source/format family as buildNativeStickerPayload + the
  // native truncate(12) — NOT the old en-PH long date.
  const sess = trunc(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), 12);
  // The order this sticker prints (onPrint passes a single-order buyer; reprint
  // rebuilds one). item = the CODE ("A2" / "A2 x2") for auto orders, else the
  // price string for manual — rendered LARGE at the bottom, mirroring native.
  const codeItem = buyer.orders?.[0]?.item;
  const codeTime = buyer.orders?.[0]?.time;
  // QR (same content rules as the phone): toggle on (+ entitled), @username line on,
  // handle not blank. Bottom-right; the lines that can reach that corner (name,
  // @handle, time + big code) get right padding so text never runs under it.
  const qr = stickerQrEffective() && cfg.printBuyerUsername !== false ? webStickerQrSvg(buyer.handle) : null;
  const qrCss = qr
    ? `body{position:relative}` +
      `.qr{position:absolute;right:clamp(1mm,2.5vw,2.5mm);bottom:clamp(1mm,2.5vh,2mm);width:${qr.sizeMm}mm;height:${qr.sizeMm}mm}` +
      `.name,.user,.foot{padding-right:${qr.sizeMm + 1.5}mm}`
    : "";
  // DRIVER-DRIVEN + AUTO-FIT (web only; native tiers UNTOUCHED): NO forced @page
  // size — the Windows printer driver's paper size decides. The body is exactly
  // ONE page tall with overflow:hidden, so content can NEVER spill to a 2nd label
  // at any size ≥60×40. Fonts scale with the page height (vh, clamped so they stay
  // readable at 60×40 and grow on taller labels). Field order mirrors the native
  // TSPL sticker: header + date, Buyer #, name, @handle, then time + the CODE big
  // at the bottom (margin-top:auto). Per-field scale multipliers are NOT applied on
  // web (they don't fit the auto-fit model; native keeps them). Names/handles are
  // single-line + ellipsis so they can't push a second page (overflow:hidden is the
  // hard guarantee regardless).
  const html = `<!DOCTYPE html><html><head><title>Sticker #${esc(buyer.num)}</title><style>` +
    `@page{size:auto;margin:0}` +
    `*{box-sizing:border-box;margin:0;padding:0}` +
    `html,body{height:100%}` +
    `body{width:100%;height:100vh;overflow:hidden;display:flex;flex-direction:column;padding:clamp(1mm,2.5vh,2mm) clamp(1mm,2.5vw,2.5mm);font-family:Arial,Helvetica,sans-serif;color:#000}` +
    `.head{display:flex;align-items:flex-end;justify-content:space-between;gap:2mm;flex-shrink:0}` +
    `.brand{font-size:clamp(2.6mm,7vh,4mm);font-weight:800;white-space:nowrap}` +
    `.date{font-size:clamp(2mm,5.5vh,3mm);font-weight:600;white-space:nowrap}` +
    `.bar{height:.6mm;background:#000;margin:.6mm 0 clamp(1mm,2.5vh,2.4mm);flex-shrink:0}` +
    `.store{font-size:clamp(2.6mm,7vh,4.2mm);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}` +
    `.bnum{font-size:clamp(5mm,15vh,10mm);font-weight:900;line-height:1.02;white-space:nowrap;flex-shrink:0}` +
    `.name{font-size:clamp(3mm,9vh,5.6mm);font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;margin-top:1mm}` +
    `.user{font-size:clamp(2.4mm,6.5vh,3.8mm);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}` +
    `.foot{margin-top:auto;display:flex;flex-direction:column;min-height:0}` +
    `.ftime{font-size:clamp(2mm,5vh,2.8mm);font-weight:600}` +
    `.code{font-size:clamp(5.5mm,17vh,12mm);font-weight:900;line-height:1.02;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
    qrCss +
    `</style></head><body>` +
    `<div class="head"><span class="brand">SellerFlowLive</span><span class="date">${esc(sess)}</span></div>` +
    `<div class="bar"></div>` +
    (cfg.printStoreName && storeName ? `<div class="store">${esc(trunc(storeName, 36))}</div>` : "") +
    (cfg.printBuyerNumber ? `<div class="bnum">Buyer ${esc(buyer.num)}</div>` : "") +
    (buyer.name ? `<div class="name">${esc(trunc(buyer.name, 30))}</div>` : "") +
    (cfg.printBuyerUsername && buyer.handle ? `<div class="user">@${esc(trunc(buyer.handle.replace(/^@+/, ""), 30))}</div>` : "") +
    (cfg.printOrderItems && codeItem ? `<div class="foot">${codeTime ? `<div class="ftime">${esc(trunc(String(codeTime), 10))}</div>` : ""}<div class="code">${esc(trunc(String(codeItem), 14))}</div></div>` : "") +
    (qr ? qr.svg : "") +
    `</body></html>`;
  enqueueWebPrint({ id: jobId, html });
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
