// ONE STICKER — the glue between the engine (oneSticker.ts) and the printers.
//
// WHO GETS IT (release rules, Jeff — never surprise a seller mid-live):
//   1. the switch app_settings "one_sticker_enabled" (admins see it before) makes the NEW Live
//      print pattern screen visible on that account (setOneStickerVisible, from RedesignApp);
//   2. EACH DEVICE keeps printing EXACTLY today's sticker until the seller taps Save on the new
//      screen on THAT device (localStorage sfl_rd_one_sticker). Nothing
//      switches a device by itself. Switch OFF again → the saved choice is ignored (today's
//      sticker), not deleted.
// WHICH PATHS: the image paths only — AIMO/Phomemo D520BT SDK image, generic TSPL/ESC-POS/CPCL
// image (Y41BT, XP-420B), Niimbot SDK image, and the laptop/web print. The native TEXT sticker
// (classic mode / old app / any fallback), the iOS WiFi sticker and the ESC/POS slip are NOT
// changed here (Branch 2).
import type { Buyer } from "../../lib/orderTypes";
import { normalizeSettings, validCustomMm, recommendedSettings, snapScale, printerLimitFor, missingFonts, tooWideFor, STANDARD_SIZES, renderOneSticker, loadFontsFor, weightsFor, rasterBmpDataUrl, laptopStickerPage, framed, type OneStickerSettings, type OneStickerInput, type OneStickerRender, type RenderOpts } from "./oneSticker";
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
  // once saved, the saved size IS the size (one place) — a size remembered before the save is done
  try { localStorage.removeItem(LS_ONE_STICKER_SIZE); } catch { /* ignore */ }
}
/** ONE SIZE, BOTH PLACES: the Printer settings "Label size" label ("100x60mm (Standard)", "60x40mm")
 *  → the size the one sticker prints. null = not a size label. PURE. */
export function sizeFromPrinterLabel(label: string): { w: number; h: number } | null {
  const m = /^(\d+)x(\d+)mm/.exec(String(label || "").trim());
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}
/** The one-sticker size → the Printer settings label it shows as. PURE. */
export const printerLabelFor = (z: { w: number; h: number }): string => (z.w === 100 && z.h === 60 ? "100x60mm (Standard)" : `${z.w}x${z.h}mm`);
/** The Printer settings label for a one-sticker size — ONLY a standard, non-custom size, and never
 *  50×30 on a phone printing the TEXT / WiFi sticker (today's sticker has no such layout there);
 *  null = Printer settings must not show it (keep what it shows). PURE. */
export function psLabelFor(z: { w: number; h: number; custom?: boolean }, devicePath?: string): string | null {
  if (z.custom || !STANDARD_SIZES.some((s) => s.w === z.w && s.h === z.h)) return null;
  if (z.w === 50 && z.h === 30 && (devicePath === "text" || devicePath === "wifi")) return null;
  return printerLabelFor(z);
}
/** A size picked in Printer settings on a device that saved the new pattern: the saved one-sticker
 *  size follows (only the size changes; the rest of the pattern stays as saved). No saved pattern →
 *  nothing is saved (the device keeps today's sticker). Returns the new saved settings, or null. */
// Never a size the printer cannot take: a Niimbot (its sticker size is chosen on the new screen —
// today's Niimbot ignores Label size), a size wider than the saved printer, or 50×30 on a phone
// whose printer prints the TEXT / WiFi sticker (no 50×30 layout there). Then the saved size is KEPT
// and the caller puts Printer settings back to it with a message — both places always agree.
export interface SizeSyncContext { printerName?: string | null; niimbot?: boolean; devicePath?: string }
export type SizeSyncResult =
  | { status: "none" }                                    // no saved new sticker / same size / not a size
  | { status: "synced"; settings: OneStickerSettings }
  | { status: "kept"; reason: "niimbot" | "too_wide" | "text_50x30"; keep: { w: number; h: number; custom?: boolean }; model?: string; maxMm?: number };
export function syncOneStickerSizeFromPrinter(label: string, ctx: SizeSyncContext = {}): SizeSyncResult {
  const saved = readSavedOneSticker();
  const z = sizeFromPrinterLabel(label);
  if (!saved || !z || (saved.size.w === z.w && saved.size.h === z.h && !saved.size.custom)) return { status: "none" };
  const keep = { w: saved.size.w, h: saved.size.h, ...(saved.size.custom ? { custom: true } : {}) };
  if (ctx.niimbot) return { status: "kept", reason: "niimbot", keep };
  const wide = tooWideFor(ctx.printerName, z.w);
  if (wide) return { status: "kept", reason: "too_wide", keep, model: wide.model, maxMm: wide.maxLabelMm };
  if (z.w === 50 && z.h === 30 && (ctx.devicePath === "text" || ctx.devicePath === "wifi")) return { status: "kept", reason: "text_50x30", keep };
  const next = normalizeSettings({ ...saved, size: { w: z.w, h: z.h } });
  saveOneSticker(next);
  return { status: "synced", settings: next };
}
/** ONE SIZE, BOTH PLACES when the new screen BECOMES VISIBLE (the switch went on, an admin signed in,
 *  the app opened): a Printer settings size picked while the screen was hidden (switch OFF — nothing
 *  synced then, so switch-OFF prints stay exactly today's) is reconciled ONCE. The saved sticker
 *  follows Printer settings (same rule as a pick); when the printer can't take that size, Printer
 *  settings shows the saved size instead. Returns the label Printer settings should show, or null =
 *  leave it (nothing saved, already the same, synced, or no Printer settings label for the saved size). */
export function reconcileOneStickerSize(label: string, ctx: SizeSyncContext = {}): string | null {
  // a saved size with no Printer settings label (a custom size) is KEPT: saving it never changed Printer
  // settings' old label, so that label says nothing new — last save wins (the header shows "Custom W×H mm")
  const saved = readSavedOneSticker();
  if (saved && psLabelFor(saved.size, ctx.devicePath) == null) return null;
  const r = syncOneStickerSizeFromPrinter(label, ctx);
  if (r.status !== "kept") return null;
  const next = psLabelFor(r.keep, ctx.devicePath);
  return next && next !== label ? next : null;
}
/** Printer settings → Sticker size → Custom → Save size (Jeff 2026-11-10): the SAME saved size the Live print
 *  pattern uses (the last Save on either screen wins). Only the size changes; a W×H that is a standard size is that
 *  size (not "custom"); below 50×30 the QR is turned OFF (normalizeSettings). No saved new sticker / a size out of
 *  30–110 mm → nothing is saved (null). */
export function saveOneStickerSizeFromPrinterCustom(w: number, h: number): OneStickerSettings | null {
  const cur = readSavedOneSticker();
  if (!cur || !validCustomMm(w) || !validCustomMm(h)) return null;
  const std = STANDARD_SIZES.some((z) => z.w === w && z.h === h);
  const next = normalizeSettings({ ...cur, size: std ? { w, h } : { w, h, custom: true } });
  saveOneSticker(next);
  return next;
}
// ── ONE PLACE FOR THE SIZE (Jeff 2026-11-10) ──────────────────────────────────────────────────
// The new sticker's size is chosen ONLY in Printer settings → Sticker size (the Live print pattern shows it and
// links there). A size picked while the new sticker is NOT saved on this device yet (a laptop before its Save, a
// phone before its printer) is remembered here and used by the first draft / the Save / the auto-save; once the
// sticker is saved, its saved size is the size (a pick updates it). Accounts that don't see the new screen never
// read or write this.
export const LS_ONE_STICKER_SIZE = "sfl_rd_one_sticker_size";
type SizeOut = { w: number; h: number; custom?: true };
const asSize = (w: number, h: number): SizeOut => (STANDARD_SIZES.some((z) => z.w === w && z.h === h) ? { w, h } : { w, h, custom: true });
export function readOneStickerSizeChoice(): SizeOut | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_ONE_STICKER_SIZE) : null;
    const j = raw ? (JSON.parse(raw) as { w?: unknown; h?: unknown }) : null;
    return j && validCustomMm(j.w) && validCustomMm(j.h) ? asSize(j.w as number, j.h as number) : null;
  } catch { return null; }
}
export function clearOneStickerSizeChoice(): void { try { localStorage.removeItem(LS_ONE_STICKER_SIZE); } catch { /* ignore */ } }
/** The widest label the saved printer takes, for the size list: printerLimitFor, and a Niimbot whose name is not
 *  known yet counts as 50 mm (like seedOneSticker) — never the full list on a small roll. PURE. */
export function oneStickerLimitFor(printerName: string | null | undefined, niimbot = false): { model: string; maxLabelMm: number } | null {
  const lim = printerLimitFor(printerName);
  if (lim) return { model: lim.model, maxLabelMm: lim.maxLabelMm };
  return niimbot ? { model: "Niimbot", maxLabelMm: 50 } : null;
}
/** The sizes Printer settings lists for the new sticker: 50×30 … 100×60, none wider than the saved printer
 *  takes (B1 / B21 → 50×30 only, B3S → up to 70×50, an unknown Niimbot → 50×30). PURE. */
export function oneStickerSizesFor(printerName: string | null | undefined, niimbot = false): { w: number; h: number }[] {
  const lim = oneStickerLimitFor(printerName, niimbot);
  return STANDARD_SIZES.filter((z) => !lim || z.w <= lim.maxLabelMm).map((z) => ({ w: z.w, h: z.h }));
}
/** The new sticker's size on this device right now: the saved sticker's size; else the size picked in Printer
 *  settings (when the printer takes it); else the first draft's (seedOneSticker — Niimbot → the biggest it takes). */
export function oneStickerSizeNow(pp: SeedPattern, psSize: string, path: string, printerName: string | null): SizeOut {
  const saved = readSavedOneSticker();
  if (saved) return saved.size.custom ? { w: saved.size.w, h: saved.size.h, custom: true } : { w: saved.size.w, h: saved.size.h };
  // a TEXT / WiFi device picks on today's list (psSize) — a size remembered from another tab never overrides it
  const choice = path === "text" || path === "wifi" ? null : readOneStickerSizeChoice();
  const lim = oneStickerLimitFor(printerName, path === "niimbot");
  if (choice && !(lim && choice.w > lim.maxLabelMm)) return choice;
  const z = seedOneSticker(pp, psSize, false, path, printerName).size;
  return asSize(z.w, z.h);
}
/** A size picked in Printer settings (a listed size or Custom W×H, 30–110 mm): the saved new sticker follows
 *  (only the size; below 50×30 the QR goes OFF — normalizeSettings); nothing saved yet → remembered for the first
 *  draft / Save. Returns { size, saved } (saved = the new saved settings, or null), or null for a size out of range. */
export function pickOneStickerSize(w: number, h: number): { size: SizeOut; saved: OneStickerSettings | null } | null {
  if (!validCustomMm(w) || !validCustomMm(h)) return null;
  const size = asSize(w, h);
  const cur = readSavedOneSticker();
  if (cur) {
    const next = normalizeSettings({ ...cur, size });
    saveOneSticker(next);
    return { size, saved: next };
  }
  try { localStorage.setItem(LS_ONE_STICKER_SIZE, JSON.stringify({ w, h })); } catch { /* ignore */ }
  return { size, saved: null };
}

/** The Print Pattern fields the first draft is made from (screens/PrintPattern PrintPatternState). */
export interface SeedPattern { shopName: boolean; shopNameSize: number; buyerNum: boolean; buyerNumSize: number; tiktokName: boolean; tiktokNameSize: number; tiktokUser: boolean; tiktokUserSize: number; comment: boolean; commentSize: number }
// ONE STICKER: the first draft of the new pattern = this device's current pattern (so the preview
// starts from what the seller already prints), Bold, today's size.
export function seedOneSticker(pp: SeedPattern, psSize: string, qr: boolean, path: string, printerName: string | null): OneStickerSettings {
  const m = psSize.match(/(\d+)x(\d+)/);
  let size = m && STANDARD_SIZES.some((z) => z.w === Number(m[1]) && z.h === Number(m[2])) ? { w: Number(m[1]), h: Number(m[2]) } : { w: 100, h: 60 };
  // Niimbot prints 50×30 today whatever size is stored (the stored size is usually the untouched
  // 100×60 default): start from the biggest standard size the saved printer takes (B1/B21 → 50×30).
  if (path === "niimbot") {
    const max = printerLimitFor(printerName)?.maxLabelMm ?? 50;
    size = [...STANDARD_SIZES].reverse().find((z) => z.w <= max) ?? { w: 50, h: 30 };
  } else { const lim = printerLimitFor(printerName); if (lim && size.w > lim.maxLabelMm) size = [...STANDARD_SIZES].reverse().find((z) => z.w <= lim.maxLabelMm) ?? size; }
  // a TEXT / WiFi phone has no 50×30 layout: never start (and so never one-tap Save) at 50×30
  if ((path === "text" || path === "wifi") && size.w === 50 && size.h === 30) size = { w: 60, h: 40 };
  const s = recommendedSettings(size);
  const part = (on: boolean, scale: number) => ({ on, weight: "bold" as const, scale: snapScale(Math.min(2, scale || 1)) });
  s.parts = { shop: part(pp.shopName, pp.shopNameSize), buyer: part(pp.buyerNum, pp.buyerNumSize), name: part(pp.tiktokName, pp.tiktokNameSize), user: part(pp.tiktokUser, pp.tiktokUserSize), comment: part(pp.comment, pp.commentSize) };
  s.qr = qr;
  return s;
}

// AUTO-SAVE (Jeff 2026-11-10): on a PHONE whose account sees the new Live print pattern, the first open saves
// the new sticker by itself (no Save tap) — once per phone. Only when the visibility is CERTAIN (the feature
// list and the switches finished loading — a failed or pending read never counts), only on a phone that prints
// the picture sticker (D520 / generic TSPL·ESC/POS·CPCL / Niimbot — never the laptop, the text sticker or WiFi),
// only once a Bluetooth sticker printer is SAVED on this phone (before that the path is a guess — a first-time
// Niimbot setup would otherwise be saved as an AIMO 100×60), and only while nothing is saved yet (a saved standard
// or Custom size is never touched). PURE.
export const AUTO_SAVE_PATHS: readonly string[] = ["d520", "tspl", "escpos", "cpcl", "niimbot"];
export function shouldAutoSaveOneSticker(c: { visible: boolean; flagsLoaded: boolean; devicePath: string; printerSaved: boolean; saved: boolean }): boolean {
  return c.visible && c.flagsLoaded && c.printerSaved && !c.saved && AUTO_SAVE_PATHS.includes(c.devicePath);
}
/** The ONE read-only native ask for the saved Bluetooth printer on open (so the auto-save sees a long-time
 *  AIMO user's printer): only for an account that sees the screen, both reads answered, a Bluetooth phone that
 *  can auto-save (picture sticker — never WiFi / text / laptop), nothing known and nothing saved yet. PURE. */
export function shouldAskSavedPrinter(c: { visible: boolean; flagsLoaded: boolean; btBridge: boolean; printerKnown: boolean; saved: boolean; devicePath: string }): boolean {
  return c.visible && c.flagsLoaded && c.btBridge && !c.printerKnown && !c.saved && AUTO_SAVE_PATHS.includes(c.devicePath);
}
/** Saves the first draft (seedOneSticker) when shouldAutoSaveOneSticker says so; returns it, or null. */
export function autoSaveOneSticker(c: { visible: boolean; flagsLoaded: boolean; devicePath: string; printerSaved: boolean }, pp: SeedPattern, psSize: string, qr: boolean, printerName: string | null): OneStickerSettings | null {
  if (!shouldAutoSaveOneSticker({ ...c, saved: readSavedOneSticker() != null })) return null;
  // a size picked in Printer settings before this save (and the printer takes it) is the size — one place
  const seed = seedOneSticker(pp, psSize, qr, c.devicePath, printerName);
  const choice = readOneStickerSizeChoice();
  const lim = oneStickerLimitFor(printerName, c.devicePath === "niimbot"); // an unknown Niimbot = 50 mm
  const s = normalizeSettings(choice && !(lim && choice.w > lim.maxLabelMm) ? { ...seed, size: choice } : seed); // normalize: the QR rule (none below 50×30)
  saveOneSticker(s);
  return s;
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
export function oneStickerVisibleFor(role: string | null | undefined, switchOn: boolean, isAdmin: boolean, listed = false): boolean {
  void role;
  return switchOn || isAdmin || listed; // listed = feature "one_sticker" for this login (sql/146)
}
// Every language on today's sticker: the switch, an admin, or feature "sticker_all_scripts" for this login (sql/146).
export function stickerAllScriptsFor(switchOn: boolean, isAdmin: boolean, listed = false): boolean {
  return switchOn || isAdmin || listed;
}

// ── Input (one buyer → what prints) ───────────────────────────────────────────────────────────
const TAIPEI_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }); // "11/07" — the approved preview prints "MM/DD HH:MM"
const TAIPEI_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); // 00:05, never "24:05"
export const BRAND_FALLBACK = "SellerFlowLive";
/** The shop line: the seller's own shop name, or nothing — NEVER the app's brand. */
export const stickerShopName = (storeName: string | null | undefined): string => {
  const s = String(storeName ?? "").trim();
  return s.replace(/\s+/g, "").toLowerCase() === BRAND_FALLBACK.toLowerCase() ? "" : s; // "sellerflowlive", "Seller Flow Live" …
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

// ── The sample (approved preview): what the screen shows AND what its test buttons print ──────
// Buyer #128 "Maria Santos" @maria_live (TikTok), the seller's own shop name, today's Taipei date &
// time; the long-comment tests swap the comment only. Never the app's brand, never a brand QR.
export const ONE_STICKER_SAMPLE = { buyerNum: 128, name: "Maria Santos", handle: "maria_live", platform: "TikTok", items: ["COMMENT / PRICE"] } as const;
export function sampleInput(shopName: string, at: number = Date.now()): OneStickerInput {
  return { storeName: stickerShopName(shopName), date: TAIPEI_DATE.format(new Date(at)), time: TAIPEI_TIME.format(new Date(at)), buyerNum: ONE_STICKER_SAMPLE.buyerNum, name: ONE_STICKER_SAMPLE.name, handle: ONE_STICKER_SAMPLE.handle, platform: ONE_STICKER_SAMPLE.platform, items: [...ONE_STICKER_SAMPLE.items] };
}
/** The sample as an order (for the test prints): the same buyer, `item` = the comment. */
export function sampleBuyer(item: string = ONE_STICKER_SAMPLE.items[0], at: number = Date.now()): Buyer {
  const S = ONE_STICKER_SAMPLE;
  return { num: S.buyerNum, name: S.name, handle: S.handle, platform: S.platform, totalSpent: 0, totalOrders: 1,
    orders: [{ orderNum: at, item, qty: 1, price: 0, total: 0, time: TAIPEI_TIME.format(new Date(at)), handle: S.handle, name: S.name, bNum: S.buyerNum, platform: S.platform, status: "New", date: new Date(at).toISOString().slice(0, 10) }] } as unknown as Buyer;
}

/** The test print of Printer settings / the old pattern: on a device that saved the new sticker it
 *  prints the preview's sample (#128 Maria Santos) with the seller's own shop — never @sellerflow, the
 *  brand or a brand QR. Every other device: exactly today's test buyer and shop. */
export function testPrintFor<S extends string | undefined>(todayBuyer: Buyer, storeName: S): { buyer: Buyer; storeName: S | string } {
  return oneStickerActive() ? { buyer: sampleBuyer(), storeName: stickerShopName(storeName) } : { buyer: todayBuyer, storeName }; // inactive: exactly today's arguments
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
/** The screen's fonts (preview + notes): rejects when anything the picture needs did not load, so the
 *  screen shows "Preview couldn't load" instead of a device-font picture and "Everything fits". */
export async function oneStickerScreenFonts(s: OneStickerSettings, inp: OneStickerInput): Promise<Fonts> {
  const fonts = await oneStickerFonts(s, inp);
  const miss = missingFonts(s, inp, fonts);
  if (miss.length) throw new Error(`fonts missing: ${miss.join(",")}`);
  return fonts;
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
