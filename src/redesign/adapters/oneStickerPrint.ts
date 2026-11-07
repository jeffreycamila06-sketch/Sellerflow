// ONE STICKER — the glue between the engine (oneSticker.ts) and the printers.
//
// WHO GETS IT (release rules, Jeff — never surprise a seller mid-live):
//   1. the switch app_settings "one_sticker_enabled" (admins see it before) makes the NEW Live
//      print pattern screen visible on that account (setOneStickerVisible, from RedesignApp);
//   2. EACH DEVICE keeps printing EXACTLY today's sticker until the seller changes something on
//      that new screen and taps Save on THAT device (localStorage sfl_rd_one_sticker). Nothing
//      switches a device by itself. Switch OFF again → the saved choice is ignored (today's
//      sticker), not deleted.
// WHICH PATHS: the image paths only — AIMO/Phomemo D520BT SDK image, generic TSPL/ESC-POS/CPCL
// image (Y41BT, XP-420B), Niimbot SDK image, and the laptop/web print. The native TEXT sticker
// (classic mode / old app / any fallback), the iOS WiFi sticker and the ESC/POS slip are NOT
// changed here (Branch 2).
import type { Buyer } from "../../lib/orderTypes";
import { normalizeSettings, renderOneSticker, loadFontsFor, weightsFor, rasterBmpDataUrl, laptopStickerPage, framed, type OneStickerSettings, type OneStickerInput, type OneStickerRender, type RenderOpts } from "./oneSticker";
import type { Fonts } from "./oneStickerText";
import { loadCjkRegAtlas } from "./propAtlasLoader";
import { loadSansFace } from "./oneStickerFonts";
import { bitmapTsplFromRaster, buildSdkBitmapStream, bytesToBase64, packPrinterRaster, rotateRaster180, type FullRaster } from "./stickerRaster";
import { escposRasterBytes } from "./escposRaster";
import { cpclRasterBytes } from "./cpclRaster";
import type { TsplJobSettings } from "./printerModels";
import type { PrinterLang } from "./savedPrinter";

// ── Per-device storage ────────────────────────────────────────────────────────────────────────
export const LS_ONE_STICKER = "sfl_rd_one_sticker";       // { saved: true, settings } — this device opted in
export const LS_ONE_STICKER_SEEN = "sfl_rd_one_sticker_seen"; // "1" once the seller opened the new screen ("New" badge)
export function readSavedOneSticker(): OneStickerSettings | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_ONE_STICKER) : null;
    if (!raw) return null;
    const j = JSON.parse(raw) as { saved?: unknown; settings?: unknown };
    return j && j.saved === true ? normalizeSettings(j.settings) : null;
  } catch { return null; }
}
export function saveOneSticker(s: OneStickerSettings): void {
  try { localStorage.setItem(LS_ONE_STICKER, JSON.stringify({ saved: true, settings: s })); } catch { /* ignore */ }
  savedCache = normalizeSettings(s);
}
export function isOneStickerSeen(): boolean { try { return localStorage.getItem(LS_ONE_STICKER_SEEN) === "1"; } catch { return false; } }
export function markOneStickerSeen(): void { try { localStorage.setItem(LS_ONE_STICKER_SEEN, "1"); } catch { /* ignore */ } }

// ── Module state (synced by RedesignApp) ──────────────────────────────────────────────────────
let visible = false;               // the new screen is on for this account (switch or admin)
let savedCache: OneStickerSettings | null | undefined; // undefined = not read yet
export function setOneStickerVisible(on: boolean): void { visible = on === true; }
export function isOneStickerVisible(): boolean { return visible; }
/** The settings THIS device prints with, or null = today's sticker. */
export function oneStickerActive(): OneStickerSettings | null {
  if (!visible) return null;
  if (savedCache === undefined) savedCache = readSavedOneSticker();
  return savedCache;
}
export function __resetOneStickerState(): void { visible = false; savedCache = undefined; }
/** Who sees the new screen: everyone when the switch is on, admins before. PURE. */
export function oneStickerVisibleFor(role: string | null | undefined, switchOn: boolean, isAdmin: boolean): boolean {
  void role;
  return switchOn || isAdmin;
}

// ── Input (one buyer → what prints) ───────────────────────────────────────────────────────────
const TAIPEI_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }); // "11/07" — the approved preview prints "MM/DD HH:MM"
const TAIPEI_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
export const BRAND_FALLBACK = "SellerFlowLive";
/** The shop line: the seller's own shop name, or nothing — NEVER the app's brand. */
export const stickerShopName = (storeName: string | null | undefined): string => {
  const s = String(storeName ?? "").trim();
  return s === BRAND_FALLBACK ? "" : s;
};
export function oneStickerInputFrom(buyer: Buyer, storeName: string, at?: number, fbNameOnly = false): OneStickerInput {
  const when = at != null ? new Date(at) : new Date();
  const o0 = buyer.orders?.[0];
  const ts = typeof o0?.orderNum === "number" && o0.orderNum > 1e12 ? o0.orderNum : when.getTime();
  return {
    storeName: stickerShopName(storeName),
    // date AND time from ONE moment (the order's own time; else `at` — a reprint passes the original
    // order's time — else now), so an order at 23:59 never prints with the next day's date
    date: TAIPEI_DATE.format(new Date(ts)),
    time: TAIPEI_TIME.format(new Date(ts)),
    buyerNum: buyer.num ? buyer.num : undefined, // 0 = no buyer number (Facebook post-sales prints, postPrintSettings)
    name: buyer.name,
    handle: buyer.handle,
    platform: buyer.platform,
    fbNameOnly,
    items: (buyer.orders ?? []).map((o) => String(o.item ?? "")).filter(Boolean),
  };
}

// ── Paths ─────────────────────────────────────────────────────────────────────────────────────
export type OneStickerPath = "d520" | "tspl" | "escpos" | "cpcl" | "niimbot" | "laptop";
export const NIIMBOT_INSET_MM = 1;      // must equal printing.ts NIIMBOT_FRAME_INSET_MM + the native twins
export const NIIMBOT_EDGE_DOTS = 16;    // the B1 ±1 mm paper slack (printing.ts NIIMBOT_SAFE_EDGE_DOTS)
/** Render options for a path: Niimbot draws into the SDK frame; TSPL heads get the 1-dot ink. */
export function renderOptsFor(path: OneStickerPath, s: OneStickerSettings, job: TsplJobSettings = {}): RenderOpts {
  if (path === "niimbot") return { canvas: { w: (s.size.w - 2 * NIIMBOT_INSET_MM) * 8, h: (s.size.h - 2 * NIIMBOT_INSET_MM) * 8, edgeX: NIIMBOT_EDGE_DOTS, edgeY: 6 } };
  if (path === "tspl" && job.bold) return { inkBold: true }; // the approved 1-dot ink; the readability guard drops it per line where letters would close
  return {};
}
export async function oneStickerFonts(s: OneStickerSettings, inp: OneStickerInput): Promise<Fonts> {
  return loadFontsFor(s, inp, (cell) => loadCjkRegAtlas(cell));
}
export async function renderOneStickerFor(path: OneStickerPath, s: OneStickerSettings, inp: OneStickerInput, job: TsplJobSettings = {}): Promise<OneStickerRender> {
  const fonts = await oneStickerFonts(s, inp);
  return renderOneSticker(s, inp, fonts, renderOptsFor(path, s, job));
}

// ── Encoders (the picture → what the printer / the browser takes) ─────────────────────────────
/** AIMO/Phomemo D520BT: the SDK image stream (180° app-side, as today). */
export function d520Stream(r: FullRaster, s: OneStickerSettings): Uint8Array {
  return buildSdkBitmapStream(packPrinterRaster(rotateRaster180(r)), r.rowBytes, r.h, s.size.w, s.size.h).bytes;
}
/** Generic printers: TSPL (density/speed of the saved model) / ESC/POS / CPCL. */
export function genericBytes(lang: PrinterLang, r: FullRaster, s: OneStickerSettings, job: TsplJobSettings = {}): Uint8Array {
  if (lang === "tspl") return bitmapTsplFromRaster(r, s.size.w, s.size.h, { ...(job.density != null ? { density: job.density } : {}), ...(job.speed != null ? { speed: job.speed } : {}) }).bytes;
  return lang === "cpcl" ? cpclRasterBytes(r) : escposRasterBytes(r);
}
export interface NiimbotImageOut { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number }
export function niimbotImage(r: FullRaster, s: OneStickerSettings): NiimbotImageOut {
  return { w: r.w, h: r.h, rowBytes: r.rowBytes, data: bytesToBase64(r.buf), labelWidthMm: s.size.w, labelHeightMm: s.size.h };
}
/** The laptop print page (one W×H mm page, the picture at W×H mm). `frame` = the test print border. */
export function laptopPage(r: FullRaster, s: OneStickerSettings, title: string, frame = false): string {
  return laptopStickerPage(s.size.w, s.size.h, rasterBmpDataUrl(frame ? framed(r) : r, bytesToBase64), title);
}

// The native TEXT sticker (old app / Classic text / an SPP picture send that failed) has only the
// five fixed sizes and no 50×30 row: when the one sticker falls back to it, use the largest TEXT size
// that fits inside the chosen label (never a bigger layout than the paper).
const TEXT_SIZES: [number, number][] = [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]];
export function textStickerSizeFor(size: { w: number; h: number }): string {
  const hit = TEXT_SIZES.find(([w, h]) => w <= size.w && h <= size.h);
  return hit ? `${hit[0]}x${hit[1]}` : "60x40";
}
/** Warm the Sans weights this device prints with (app start) so the first sticker is not slow. */
export function prefetchOneStickerFonts(): void {
  const s = oneStickerActive();
  if (!s) return;
  for (const w of weightsFor(s)) void loadSansFace(w).catch(() => { /* the print retries */ });
}
