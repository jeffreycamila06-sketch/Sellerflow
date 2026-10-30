// Printer CONNECTION bridge — copied VERBATIM from App.tsx callMobilePrinterBridge
// (454-473) + btCall (2051-2057). Talks to the SAME native window.SellerFlowPrinter
// plugin production uses (setPrinter / testConnection / scanPrinters / testPrint /
// scanBluetoothLabelPrinters / …). Imports nothing from App.tsx.
//
// ⚠️ NATIVE-ONLY / PREVIEW-UNVERIFIABLE: there is no SellerFlowPrinter bridge on the
// web or the Vercel preview, so every call returns the friendly "open the app"
// result and the UI is a safe no-op. Real connection/scan/test only works inside
// the APK. (The slip/sticker payload builders live in printing.ts, byte-parity.)
import { buildNativeStickerPayload, type Settings } from "./printing";
import type { Buyer } from "../../lib/orderTypes";
import { rememberSavedPrinter, savedIsNiimbot, savedGenericLang, type PrinterLang } from "./savedPrinter";

// Result/config shapes — structurally identical to App.tsx:39-54.
export interface MobilePrinterDevice { id: string; type: "bluetooth" | "lan"; name: string; address?: string; host?: string; port?: number; paired?: boolean; online?: boolean; signal?: number; distance?: string; hint?: string }
export interface MobilePrinterResult { ok?: boolean; message?: string; online?: boolean; host?: string; port?: number; savedPrinter?: MobilePrinterDevice | null; printers?: MobilePrinterDevice[] }
export interface PrinterLanConfig { host: string; port?: number }
// transport: "ble" (GATT), "spp" (Android classic RFCOMM — paired in phone settings), "niimbot" (vendor SDK).
// brand: set by the native scan for a device whose NAME is a known vendor model (e.g. Niimbot).
export interface BluetoothPrinterDevice { id: string; address: string; name: string; paired?: boolean; signal?: number; transport?: "ble" | "spp" | "niimbot"; model?: "D520BT" | "generic"; likely?: boolean; lang?: PrinterLang; brand?: "niimbot" }
export interface BluetoothScanResult { ok?: boolean; message?: string; printers?: BluetoothPrinterDevice[]; savedPrinter?: BluetoothPrinterDevice | null }
export interface StickerPrintResult { ok?: boolean; message?: string }

export type LanBridgeAction = "scanPrinters" | "printerStatus" | "testPrint" | "connectPrinter" | "setPrinter" | "getPrinter" | "testConnection";
// `printStickerBitmap` = raw pre-built TSPL passthrough for the BITMAP sticker
// mode (new-board fix); `printRawTspl` = dormant native passthrough (the dev
// print-probe harness that used it was removed pre-merge; the native method
// stays for future diagnostics). Both route through the SAME native BLE/SPP
// transport as testStickerPrint; the TEXT path (printStickerNative) is unaffected.
export type BtBridgeAction = "scanBluetoothLabelPrinters" | "getBluetoothLabelPrinter" | "setBluetoothLabelPrinter" | "clearBluetoothLabelPrinter" | "testStickerPrint" | "printStickerNative" | "printStickerBitmap" | "printRawTspl" | "testGenericPrinter" | "printStickerImage";

export const hasNativePrinter = (): boolean => typeof window !== "undefined" && !!window.SellerFlowPrinter;
export const hasBtBridge = (): boolean => typeof window !== "undefined" && !!window.SellerFlowPrinter?.scanBluetoothLabelPrinters;

// PURE — normalize a raw bridge return (string | object | void) into MobilePrinterResult.
// Verbatim from App.tsx:464-470. Unit-tested.
export function normalizeBridgeResult(raw: unknown): MobilePrinterResult {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as MobilePrinterResult; }
    catch { return { ok: /printed|ready|online|connected/i.test(raw), message: raw }; }
  }
  if (raw && typeof raw === "object") return raw as MobilePrinterResult;
  return { ok: true, message: "Printer command sent" };
}

const OPEN_APP = "Open the SellerFlowLive app on your phone to set up this printer.";

// LAN/WiFi bridge — verbatim from App.tsx:454-473.
export async function callMobilePrinterBridge(action: LanBridgeAction, printer?: MobilePrinterDevice | PrinterLanConfig): Promise<MobilePrinterResult> {
  if (typeof window === "undefined" || !window.SellerFlowPrinter) return { ok: false, message: OPEN_APP };
  const bridge = window.SellerFlowPrinter;
  try {
    let raw: unknown;
    if (action === "setPrinter") raw = await bridge.setPrinter?.(printer as PrinterLanConfig);
    else if (action === "getPrinter") raw = await bridge.getPrinter?.();
    else if (action === "testConnection") raw = await bridge.testConnection?.(printer as PrinterLanConfig);
    else if (action === "connectPrinter") raw = await bridge.connectPrinter?.(printer ? JSON.stringify(printer) : "");
    else if (action === "scanPrinters") raw = await bridge.scanPrinters?.();
    else if (action === "printerStatus") raw = await bridge.printerStatus?.();
    else if (action === "testPrint") raw = await bridge.testPrint?.();
    return normalizeBridgeResult(raw);
  } catch {
    // Never the raw printer/app text — one plain sentence for the seller.
    return { ok: false, message: "Printer didn't respond. Check it's on." };
  }
}

// Bluetooth bridge — verbatim from App.tsx:2051-2057. Returns null when the bridge
// or method is absent (web/preview) or on error; the caller surfaces status.
export async function btCall<T>(action: BtBridgeAction, arg?: unknown): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const bridge = window.SellerFlowPrinter as Record<string, ((a?: unknown) => Promise<unknown>) | undefined> | undefined;
  const fn = bridge?.[action];
  if (typeof fn !== "function") return null;
  try {
    const r = (arg === undefined ? await fn() : await fn(arg)) as T;
    // Printer setup v2: every answer that carries `savedPrinter` is the native truth about
    // the saved sticker printer (model / language) — remember it for the print router.
    if (SAVED_PRINTER_ACTIONS.has(action) && r && typeof r === "object" && "savedPrinter" in (r as object)) rememberSavedPrinter((r as { savedPrinter?: unknown }).savedPrinter);
    return r;
  } catch { return null; }
}
const SAVED_PRINTER_ACTIONS: ReadonlySet<BtBridgeAction> = new Set(["getBluetoothLabelPrinter", "setBluetoothLabelPrinter", "clearBluetoothLabelPrinter", "scanBluetoothLabelPrinters"]);

// Like btCall but PRESERVES the native reject {code, message} instead of
// collapsing it to null — the Test Print button needs the reject CODE to tell
// "no printer saved" (BT_NOT_SET) apart from a real print failure. Additive:
// btCall is untouched, so its null-contract consumers are unaffected.
export interface BtCallOutcome { ok: boolean; code: string; message: string; }
export async function btCallOutcome(action: BtBridgeAction, arg?: unknown): Promise<BtCallOutcome> {
  if (typeof window === "undefined") return { ok: false, code: "", message: "" };
  const bridge = window.SellerFlowPrinter as Record<string, ((a?: unknown) => Promise<unknown>) | undefined> | undefined;
  const fn = bridge?.[action];
  if (typeof fn !== "function") return { ok: false, code: "", message: "" };
  try {
    const raw = (arg === undefined ? await fn() : await fn(arg)) as StickerPrintResult | null;
    return { ok: !!raw?.ok, code: "", message: typeof raw?.message === "string" ? raw.message : "" };
  } catch (err) {
    const e = (err && typeof err === "object" ? err : {}) as { code?: unknown; message?: unknown };
    return { ok: false, code: typeof e.code === "string" ? e.code : "", message: typeof e.message === "string" ? e.message : "" };
  }
}

// The Bluetooth scan with its FAILURE kept: Android REJECTS with a code (BT_DISABLED /
// BT_PERMISSION / BT_NO_ADAPTER…), iOS RESOLVES {ok:false, message}. Both end up as
// {ok:false, code, message} so btState can tell "off" / "not allowed" apart. A saved printer
// echoed back is remembered like btCall does.
export interface BtScanOutcome { ok: boolean; code: string; message: string; printers: BluetoothPrinterDevice[]; savedPrinter: BluetoothPrinterDevice | null }
export async function btScanOutcome(arg?: unknown): Promise<BtScanOutcome> {
  const none = (code = "", message = ""): BtScanOutcome => ({ ok: false, code, message, printers: [], savedPrinter: null });
  if (typeof window === "undefined") return none();
  const fn = (window.SellerFlowPrinter as Record<string, ((a?: unknown) => Promise<unknown>) | undefined> | undefined)?.scanBluetoothLabelPrinters;
  if (typeof fn !== "function") return none();
  try {
    const r = (arg === undefined ? await fn() : await fn(arg)) as BluetoothScanResult | null;
    if (r && typeof r === "object" && "savedPrinter" in r) rememberSavedPrinter(r.savedPrinter);
    return { ok: r?.ok !== false, code: "", message: typeof r?.message === "string" ? r.message : "", printers: r?.printers || [], savedPrinter: r?.savedPrinter || null };
  } catch (err) {
    const e = (err && typeof err === "object" ? err : {}) as { code?: unknown; message?: unknown };
    return none(typeof e.code === "string" ? e.code : "", typeof e.message === "string" ? e.message : "");
  }
}

// ── Generic BLE label printers (printer setup v2) ────────────────────────────
// The v2 Printer settings flow (printerModels.printerFlowV2Enabled) needs an app build new
// enough to STORE a generic printer (marker: the native testGenericPrinter method exists);
// older apps keep today's screen. The web never calls that method any more.
export const hasGenericPrinterBridge = (): boolean =>
  typeof window !== "undefined" && typeof (window.SellerFlowPrinter as Record<string, unknown> | undefined)?.testGenericPrinter === "function";

// ── Niimbot (vendor SDK) — printer setup v2 Part 8 ──────────────────────────
// The sticker IMAGE the native Niimbot driver prints as one label: 1-bit rows (MSB first,
// bit 1 = ink), `data` = the packed rows base64, plus the label size in mm. The driver is
// in an app build only when the native printStickerImage method exists.
export interface NiimbotImage { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number }
export const hasNiimbotBridge = (): boolean =>
  typeof window !== "undefined" && typeof (window.SellerFlowPrinter as Record<string, unknown> | undefined)?.printStickerImage === "function";
// iOS only: the Niimbot driver lives in an embedded framework that needs iOS 17.2+; the shell
// sets this flag on older iOS so the settings screen says so BEFORE any test print.
export const niimbotOsTooOld = (): boolean =>
  typeof window !== "undefined" && (window.SellerFlowPrinter as Record<string, unknown> | undefined)?.niimbotOsTooOld === true;

// Test-sticker buyer — copied from App.tsx:2086 (rollback app keeps its own
// string by convention). Exported so the web Printer Test can browser-print the
// SAME test pattern via printSlip (no BT bridge). The sample item prints in the
// comment/price-code column (12-char truncate) — "PRICE" per Jeff 2026-07-22
// (the old "SellerFlowLive sticker test" printed as a confusing "SellerFlowLi").
// Printer setup v2 — the test sticker for GENERIC and NIIMBOT printers only (image paths):
// Chinese in the name and the comment so a seller sees at once whether CJK prints. The
// Chinese comes FIRST because the 50×30 layout cuts a mixed line with "…" next to the QR
// (7 CJK-wide cells): "測試 Tes…" still shows the Chinese; "Test Print 測…" would not.
// The D520BT test sticker keeps buildTestBuyer() byte-for-byte (its stream is golden-pinned).
export const TEST_NAME_V2 = "測試 Test Print";
export const TEST_COMMENT_V2 = "好 COMMENT / PRICE";
export function buildTestBuyerV2(): Buyer {
  const b = buildTestBuyer();
  return { ...b, name: TEST_NAME_V2, orders: [{ ...b.orders[0], item: TEST_COMMENT_V2, name: TEST_NAME_V2 }] };
}

/**
 * The test sticker for the SAVED printer (the Settings / Print Pattern "Test print" buttons):
 * a saved generic or Niimbot printer prints the Chinese v2 sticker (image path) — the same as
 * the pick flow printed when it was set up; the D520BT keeps buildTestBuyer() (golden-pinned
 * stream). Issue B (Oct 26): these buttons used buildTestBuyer() for every printer, so a saved
 * Niimbot printed "Test Print / PRICE" while the pick flow printed "測試 Test Print".
 */
export function savedTestBuyer(): Buyer {
  return savedIsNiimbot() || savedGenericLang() !== null ? buildTestBuyerV2() : buildTestBuyer();
}

export function buildTestBuyer(): Buyer {
  return { handle: "sellerflow", name: "Test Print", platform: "TikTok", num: 88, orders: [{ orderNum: 1, item: "PRICE", qty: 1, price: 350, total: 350, time: new Date().toLocaleTimeString(), handle: "sellerflow", name: "Test Print", bNum: 88, platform: "TikTok", status: "New", date: new Date().toISOString().slice(0, 10) }], totalSpent: 350, totalOrders: 1 } as Buyer;
}

// Fed through the byte-parity buildNativeStickerPayload (printing.ts) into
// printStickerNative.
export function buildTestStickerPayload(cur: string, storeName: string, settings: Settings) {
  return buildNativeStickerPayload(buildTestBuyer(), cur || "NT$", storeName || "SellerFlowLive", settings);
}
