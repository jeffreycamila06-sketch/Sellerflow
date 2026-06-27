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
// Web / preview (no native bridge) → NO-OP (returns {ok:false, via:"none"}); it does
// NOT open a browser print dialog. Real device printing is APK-only.
import { shouldUseBluetoothSticker, shouldUseLanSticker } from "../../lib/printerRouting";
import type { Buyer } from "../../lib/orderTypes";

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
        const text = m.message || "Native printer failed.";
        console.warn(text);
        window.alert(text);
        return;
      }
      if (typeof msg !== "string" || !msg.trim()) return;
      if (/printed to/i.test(msg)) return;
      console.warn(msg);
      window.alert(msg);
    }).catch((err) => console.warn("Native printer bridge failed.", err));
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

async function printStickerViaBluetooth(buyer: Buyer, cur: string, storeName: string, cfg: Settings): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (!bridge?.printStickerNative) return false;
  try {
    const result = await bridge.printStickerNative(buildNativeStickerPayload(buyer, cur, storeName, cfg));
    return !!result?.ok;
  } catch (err) { console.warn("printStickerNative bridge call failed:", err); return false; }
}

async function printStickerViaLan(buyer: Buyer, cur: string, storeName: string, cfg: Settings): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (!bridge?.printStickerLan) return false;
  try {
    const result = await bridge.printStickerLan(buildNativeStickerPayload(buyer, cur, storeName, cfg));
    return !!result?.ok;
  } catch (err) { console.warn("printStickerLan bridge call failed:", err); return false; }
}

// ── Router — mirrors App.tsx printSlip routing (538-660), native paths only.
// Web/preview (no bridge) → no-op, no browser dialog. Returns where it went.
export type PrintVia = "bluetooth" | "lan" | "native-slip" | "none";
export interface PrintResult { ok: boolean; via: PrintVia; }

export function printSlip(buyer: Buyer, cur: string, storeName: string, printSettings: Settings | string): PrintResult {
  const cfg: Settings = typeof printSettings === "string" ? { ...DEF_SETTINGS, stickerSize: printSettings } : printSettings;
  const nativePrinter = typeof window !== "undefined" ? window.SellerFlowPrinter : undefined;
  if (shouldUseBluetoothSticker(cfg.printerType, !!nativePrinter?.printStickerNative)) {
    void printStickerViaBluetooth(buyer, cur, storeName, cfg).then((ok) => { if (!ok) console.warn("[BT sticker] print failed — check pairing/selection."); });
    return { ok: true, via: "bluetooth" };
  }
  if (shouldUseLanSticker(cfg.printerType, cfg.lanFormat, !!nativePrinter?.printStickerLan)) {
    void printStickerViaLan(buyer, cur, storeName, cfg).then((ok) => { if (!ok) console.warn("[LAN sticker] print failed — check WiFi printer IP."); });
    return { ok: true, via: "lan" };
  }
  const nativePayload = buildSlipPayload(buyer, cur, storeName, cfg);
  if (hasNativeMobilePrinter() && sendSlipToNativePrinter(nativePayload)) return { ok: true, via: "native-slip" };
  // Web/preview: no native bridge → no-op (the "Printed" badge is the would-print
  // indication; real device print is APK-only).
  return { ok: false, via: "none" };
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
    printOrderScale: lvl(pp.commentSize),
    printCommentScale: lvl(pp.commentSize),
  };
}
