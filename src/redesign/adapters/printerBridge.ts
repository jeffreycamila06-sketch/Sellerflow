// Printer CONNECTION bridge — copied VERBATIM from App.tsx callMobilePrinterBridge
// (454-473) + btCall (2051-2057). Talks to the SAME native window.SellerFlowPrinter
// plugin production uses (setPrinter / testConnection / scanPrinters / testPrint /
// scanBluetoothLabelPrinters / …). Imports nothing from App.tsx.
//
// ⚠️ NATIVE-ONLY / PREVIEW-UNVERIFIABLE: there is no SellerFlowPrinter bridge on the
// web or the Vercel preview, so every call returns the friendly "open the app"
// result and the UI is a safe no-op. Real connection/scan/test only works inside
// the APK. (The slip/sticker payload builders live in printing.ts, byte-parity.)
import { buildNativeStickerPayload, buildScalesRaw, type Settings } from "./printing";
import type { Buyer } from "../../lib/orderTypes";

// Result/config shapes — structurally identical to App.tsx:39-54.
export interface MobilePrinterDevice { id: string; type: "bluetooth" | "lan"; name: string; address?: string; host?: string; port?: number; paired?: boolean; online?: boolean; signal?: number; distance?: string; hint?: string }
export interface MobilePrinterResult { ok?: boolean; message?: string; online?: boolean; host?: string; port?: number; savedPrinter?: MobilePrinterDevice | null; printers?: MobilePrinterDevice[] }
export interface PrinterLanConfig { host: string; port?: number }
export interface BluetoothPrinterDevice { id: string; address: string; name: string; paired?: boolean; signal?: number }
export interface BluetoothScanResult { ok?: boolean; message?: string; printers?: BluetoothPrinterDevice[]; savedPrinter?: BluetoothPrinterDevice | null }
export interface StickerPrintResult { ok?: boolean; message?: string }
// In-app pairing result (Android nearby-discovery flow). bonded === paired ok.
export interface BluetoothBondResult { ok?: boolean; bonded?: boolean; address?: string; name?: string; message?: string; code?: string }

export type LanBridgeAction = "scanPrinters" | "printerStatus" | "testPrint" | "connectPrinter" | "setPrinter" | "getPrinter" | "testConnection";
export type BtBridgeAction = "scanBluetoothLabelPrinters" | "getBluetoothLabelPrinter" | "setBluetoothLabelPrinter" | "clearBluetoothLabelPrinter" | "testStickerPrint" | "printStickerNative" | "discoverBluetoothPrinters" | "bondBluetoothDevice";

export const hasNativePrinter = (): boolean => typeof window !== "undefined" && !!window.SellerFlowPrinter;
export const hasBtBridge = (): boolean => typeof window !== "undefined" && !!window.SellerFlowPrinter?.scanBluetoothLabelPrinters;
// Nearby-discovery + in-app pairing (Android classic-SPP only). Absent on iOS (BLE
// bridge) and on old binaries, so the web feature-gates the nearby half of Scan on it.
export const hasDiscoverBridge = (): boolean => typeof window !== "undefined" && !!(window.SellerFlowPrinter as Record<string, unknown> | undefined)?.discoverBluetoothPrinters;

// PURE — is a DISCOVERED (unpaired) device likely a sticker printer? The single
// merged "Scan" appends nearby-unpaired discovery to the bonded list; raw
// discovery sees EVERY classic BT device around (phones, TVs, speakers), which
// would read as broken noise in the printer picker. Known families: Phomemo
// PM-2xx, the AIMO D520 line, plus generic label/printer names. Applied ONLY to
// the discovery (unpaired) results — the bonded list from
// scanBluetoothLabelPrinters is NEVER filtered (AIMO flow byte-unchanged).
// Unit-tested; an unknown new printer model can still be paired once in Android
// Settings and then appears via the bonded list.
export function isLikelyStickerPrinter(name: string | undefined): boolean {
  if (!name) return false;
  return /^PM-2|D520|AIMO|printer|label/i.test(name.trim());
}

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

const OPEN_APP = "Open this inside the SellerFlow mobile app to use phone printer scanning.";

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
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, message: e?.message || String(err) || "Printer bridge failed" };
  }
}

// Bluetooth bridge — verbatim from App.tsx:2051-2057. Returns null when the bridge
// or method is absent (web/preview) or on error; the caller surfaces status.
export async function btCall<T>(action: BtBridgeAction, arg?: unknown): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const bridge = window.SellerFlowPrinter as Record<string, ((a?: unknown) => Promise<unknown>) | undefined> | undefined;
  const fn = bridge?.[action];
  if (typeof fn !== "function") return null;
  try { return (arg === undefined ? await fn() : await fn(arg)) as T; }
  catch (err) {
    // A native call.reject(message, code) lands here. Surfacing it (instead of
    // the old `return null`) lets the screens show the REAL failure — the null
    // swallow reduced every reject to the generic "check pairing" toast, which
    // hid the actual stage during the 2026-07-16 Phomemo Phase 0 device test.
    // Callers only read `ok`/`message` (or optional fields that stay undefined),
    // so the absent-bridge `null` contract is unchanged.
    const e = err as { message?: string; code?: string };
    return { ok: false, message: e?.message || String(err) || "Printer bridge failed", code: e?.code } as T;
  }
}

// Test-sticker buyer. Exported so the web Printer Test can browser-print the SAME
// test pattern via printSlip (no BT bridge). The order `item` is the big price-code
// marquee on the sticker — Jeff asked it to read "PRICE" (was "SellerFlowLive
// sticker test"). Shared by AIMO + 241 (both flow through printStickerNative), so
// this is intentional parity — the AIMO test print shows "PRICE" too.
export function buildTestBuyer(): Buyer {
  return { handle: "sellerflow", name: "Test Print", platform: "TikTok", num: 88, orders: [{ orderNum: 1, item: "PRICE", qty: 1, price: 350, total: 350, time: new Date().toLocaleTimeString(), handle: "sellerflow", name: "Test Print", bNum: 88, platform: "TikTok", status: "New", date: new Date().toISOString().slice(0, 10) }], totalSpent: 350, totalOrders: 1 } as Buyer;
}

// Fed through the byte-parity buildNativeStickerPayload (printing.ts) into
// printStickerNative. isTest marks it as the Test-Print button (the redesign's
// test goes through printStickerNative, NOT testStickerPrint). On the 241 the
// native side prints this test through the SAME buildTsplSticker241 + full
// settings/scales a real order uses (identical output) — isTest only lets it
// past the temporary 241 order guard that still no-ops REAL orders. The AIMO
// native path ignores the flag — the underlying payload is byte-unchanged.
export function buildTestStickerPayload(cur: string, storeName: string, settings: Settings) {
  // scalesRaw (241-only): carries the exact decimal size adjusters to the raster path
  // so the Test Print reflects each 0.1 step (AIMO ignores it). Absent → 241 falls
  // back to the rounded integer scale. See printing.buildScalesRaw.
  const scalesRaw = buildScalesRaw(settings);
  const base = { ...buildNativeStickerPayload(buildTestBuyer(), cur || "NT$", storeName || "SellerFlowLive", settings), isTest: true };
  return scalesRaw ? { ...base, scalesRaw } : base;
}
