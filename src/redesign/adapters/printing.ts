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

// HTML-escape + buyer-number color — copied VERBATIM from App.tsx:196, 227 (used by
// the browser-print slip below).
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
const nc = (n: number) => (n === 1 ? "#26215C" : n <= 3 ? "#534AB7" : "#7F77DD");

// ── Router — mirrors App.tsx printSlip routing (620-704). Native paths fire first
// (BT/iOS-LAN/native-slip via the bridge); on a plain WEB browser (no bridge) it falls
// through to the SAME browser-print path as old main (hidden iframe + window.print),
// copied verbatim so web output is byte-identical. Returns where it went.
export type PrintVia = "bluetooth" | "lan" | "native-slip" | "browser" | "none";
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
  // ── WEB FALLBACK: browser print — COPIED VERBATIM from App.tsx:646-703 (hidden
  // iframe + window.print of the slip HTML). Restores old-main web behavior. ──────
  const size = cfg.stickerSize;
  // Size is an INTEGER LEVEL 1-8 (was 60-180%); use the level directly as the
  // browser-print font multiplier so web matches the sticker (1 = base).
  const scale = (v: number | undefined, fallback = 1) => Math.max(1, Math.min(8, Number(v || fallback || 1)));
  const storeScale = scale(cfg.printStoreScale, cfg.printLabelScale);
  const buyerNumberScale = scale(cfg.printBuyerNumberScale, 1);
  const buyerNameScale = scale(cfg.printBuyerNameScale, cfg.printLabelScale);
  const usernameScale = scale(cfg.printUsernameScale, cfg.printLabelScale);
  const orderScale = scale(cfg.printOrderScale, cfg.printLabelScale);
  const commentScale = scale(cfg.printCommentScale, cfg.printLabelScale);
  const totalScale = scale(cfg.printTotalScale, cfg.printLabelScale);
  const pos = (v: number | undefined) => Math.max(-40, Math.min(40, v || 0));
  const sess = new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Taipei", month: "long", day: "numeric", year: "numeric" });
  const color = nc(buyer.num);
  const [w] = size.split("x").map(Number);
  const safeSess = esc(sess);
  const safeStoreName = esc(storeName);
  const safeBuyerNum = esc(buyer.num);
  const safeBuyerName = esc(buyer.name);
  const safeBuyerHandle = esc(buyer.handle);
  const safeCurrency = esc(cur);
  const safeTotal = buyer.totalSpent > 0 ? `${safeCurrency}${esc(buyer.totalSpent.toLocaleString())}` : "";
  const commentOnlyHtml = buyer.orders.map((o) => `<div class="order-entry"><div class="order-time">${esc(o.time)}</div><div class="order-comment">${esc(o.item)}</div></div>`).join("");
  const scaledOrderHtml = commentOnlyHtml;
  if (typeof document === "undefined") return { ok: false, via: "none" };
  const frame = document.createElement("iframe");
  frame.title = `Slip #${safeBuyerNum}`;
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
  doc.write(`<!DOCTYPE html><html><head><title>Slip #${safeBuyerNum}</title><style>@page{size:${size.replace("x", "mm ")}mm;margin:3mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;width:${w}mm;color:#000}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:3mm;margin-bottom:2.5mm}.brand{font-size:${14 * storeScale}px;font-weight:800;transform:translate(${pos(cfg.printStoreX)}mm,${pos(cfg.printStoreY)}mm)}.brand span{color:#7F77DD}.session{font-size:${12 * totalScale}px;font-weight:800;text-align:right;transform:translate(${pos(cfg.printSessionX)}mm,${pos(cfg.printSessionY)}mm)}.grid{display:grid;grid-template-columns:52% 48%;gap:3mm;align-items:start}.left{display:flex;flex-direction:column;gap:1.5mm;padding-top:1mm}.seller{font-size:${13 * storeScale}px;font-weight:800;line-height:1.1;transform:translate(${pos(cfg.printStoreX)}mm,${pos(cfg.printStoreY)}mm)}.line{font-size:${13 * buyerNameScale}px;font-weight:800;line-height:1.1}.muted{font-size:${10 * usernameScale}px;font-weight:700;color:#333}.buyer-num{font-size:${13 * buyerNumberScale}px;color:${color};font-weight:900;transform:translate(${pos(cfg.printBuyerNumberX)}mm,${pos(cfg.printBuyerNumberY)}mm)}.buyer-name{transform:translate(${pos(cfg.printBuyerNameX)}mm,${pos(cfg.printBuyerNameY)}mm)}.username{transform:translate(${pos(cfg.printUsernameX)}mm,${pos(cfg.printUsernameY)}mm)}.order-box{min-height:38mm;padding:0;transform:translate(${pos(cfg.printOrderX)}mm,${pos(cfg.printOrderY)}mm)}.order-title{font-size:${15 * orderScale}px;font-weight:900;margin-bottom:2mm}.order-entry{border-left:2px solid #000;padding-left:2mm;margin-bottom:2mm}.order-time{font-size:${9 * orderScale}px;color:#111;font-weight:500;line-height:1.1}.order-comment{font-size:${10 * commentScale}px;font-weight:800;line-height:1.1;margin-top:.8mm}.total{border-top:1px dashed #777;margin-top:2mm;padding-top:1.5mm;display:flex;justify-content:space-between;gap:2mm;font-size:${11 * totalScale}px;font-weight:800;transform:translate(${pos(cfg.printTotalX)}mm,${pos(cfg.printTotalY)}mm)}@media print{body{margin:0}}</style></head><body>
  <div class="head"><div class="brand">Seller<span>FlowLive</span></div><div class="session">Session: ${safeSess}</div></div>
  <div class="grid"><div class="left">
  ${cfg.printStoreName ? `<div class="seller">${safeStoreName}</div>` : ""}
  ${cfg.printBuyerNumber ? `<div class="line buyer-num">Buyer #${safeBuyerNum}</div>` : ""}
  <div class="line buyer-name">${safeBuyerName}</div>
  ${cfg.printBuyerUsername ? `<div class="muted username">@${safeBuyerHandle}</div>` : ""}
  </div>
  ${(cfg.printOrderItems || cfg.printTotal) ? `<div class="order-box">${cfg.printOrderItems ? `<div class="order-title">Order here</div>${scaledOrderHtml}` : ""}${cfg.printTotal ? `<div class="total"><span>Total</span><span>${safeTotal}</span></div>` : ""}</div>` : ""}
  </div>
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
