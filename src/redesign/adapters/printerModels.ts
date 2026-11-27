// Printer setup v2 — "no switch, fewer taps". Pure helpers for the Printer settings scan list:
// which rows are printers, which are already known to work (and in what command language),
// which brand needs its own driver, and the order the languages are tried on a new printer.
import type { BluetoothPrinterDevice } from "./printerBridge";
import type { PrinterLang } from "./savedPrinter";

export type { PrinterLang };

// ── Printer-name list — ONE place per platform ───────────────────────────────────────────
// A Bluetooth device whose NAME starts with one of these is a printer row even when it
// advertises no printer service (Niimbot, most classic receipt printers). Case-insensitive
// prefix match. The Java (BleStickerLogic.PRINTER_NAME_PREFIXES) and Swift
// (BleStickerLogic.printerNamePrefixes) copies are pinned equal to this list by
// printerNames.contract.test.ts — change all three together.
// EXCEPTION: "B1 Pro-" is web-only for now (WEB_ONLY_PREFIXES in that test) — the phone only tags
// rows, the web decides; the phone app adds it in its next normal release.
export const PRINTER_NAME_PREFIXES: readonly string[] = [
  // Niimbot B-series 50 mm models (vendor SDK driver — see isNiimbotName). The narrow-head
  // D11/D110/D101/H1S/B18 are NOT listed for now: they take the normal "not found / show all" path.
  "B1 Pro-", // Niimbot B1 Pro — scans as "B1 Pro-I616030055"; printed exactly like the B1
  "B1-", "B21-", "B203-", "B3S-",
  // Xprinter / generic receipt + label printers ("HM-" and "RP" were dropped: they match non-printers)
  "XP-", "Xprinter", "Printer", "PRT", "PT-", "MPT", "GP-",
  // Phomemo M-series + Q30/T02
  "M02", "M110", "M120", "M200", "M220", "M221", "Q30", "T02",
  // HPRT, Munbyn, Rongta (RP), Gprinter, Zjiang
  "HPRT", "Munbyn", "Gprinter", "Zjiang",
];
export const NIIMBOT_NAME_PREFIXES: readonly string[] = ["B1 Pro-", "B1-", "B21-", "B203-", "B3S-"];

const startsWithAny = (name: string | undefined | null, prefixes: readonly string[]): boolean => {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return false;
  for (const p of prefixes) if (n.startsWith(p.toUpperCase())) return true;
  return false;
};
export const matchesPrinterName = (name: string | undefined | null): boolean => startsWithAny(name, PRINTER_NAME_PREFIXES);
export const isNiimbotName = (name: string | undefined | null): boolean => startsWithAny(name, NIIMBOT_NAME_PREFIXES);

// KNOWN MODELS — Part 1 source: a built-in list keyed by device-name prefix. Part 2 moves
// this to the database and learns from sellers' saves: swap `knownSource` only; every
// caller goes through knownPrinterLang / isKnownPrinter and never reads the list.
// `density` / `speed` = the TSPL job header for THIS model only (DENSITY n / SPEED n); `bold` =
// 1-dot heavier ink in the generic BITMAP job (stickerRaster BandOptions.bold). Absent = the
// generic job's defaults (DENSITY 8, no SPEED line, no bold) — every other printer's bytes unchanged.
// `media` = a seller's own printer tuning (sql/230, printerTuning.ts) — the TSPL media line; absent = "GAP 2 mm, 0".
export interface TsplJobSettings { density?: number; speed?: number; bold?: boolean; media?: { sensor: "gap" | "bline" | "continuous"; mm: number } }
// `gapAfterMs` = how long the phone's printer lane waits after a sticker on THIS model before the next one
// starts (printing.ts onPrinterLane). Only the XP-420B (Jeff 2026-11-09: blank labels between stickers on a fast
// series; Flash / AIMO / Niimbot on the same roll had none). Absent = no wait, timing exactly as before.
interface KnownModel extends TsplJobSettings { prefix: string; lang: PrinterLang; gapAfterMs?: number }
// Oct 31: side by side, the AIMO D520BT sticker is very dark/clear; the Y41BT and the XP-420B
// (even at DENSITY 12 / SPEED 3) are clearly lighter → max density, slow, and bold for both.
const BUILT_IN: KnownModel[] = [
  { prefix: "Y41BT", lang: "tspl", density: 15, speed: 4, bold: true }, // FLASH LABEL Y41BT — clean TSPL sticker on the owner's iPhone (Oct 21), light at DENSITY 8; SPEED 2 too slow (Oct 31) → 4
  { prefix: "XP-420B", lang: "tspl", density: 15, speed: 4, bold: true, gapAfterMs: 1500 }, // Xprinter XP-420B — clean 60x40 TSPL sticker on the owner's iPhone (Oct 31), light at DENSITY 12; SPEED 2 too slow (Oct 31) → 4
];
let knownSource: () => KnownModel[] = () => BUILT_IN;
export function __setKnownSource(fn: (() => KnownModel[]) | null): void { knownSource = fn ?? (() => BUILT_IN); }

// The language a known model prints with, by device name; null = not in the list.
// Built-in list FIRST; an Admin-approved printer (sql/160) only when no built-in entry matches.
export function knownPrinterLang(name: string | undefined | null): PrinterLang | null {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return null;
  for (const m of knownSource()) if (n.startsWith(m.prefix.toUpperCase())) return m.lang;
  return approvedPrinterFor(name)?.lang ?? null;
}

// The per-model TSPL job (density / speed / bold) of a known model; {} = defaults.
export function knownTsplJob(name: string | undefined | null): TsplJobSettings {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return {};
  for (const m of knownSource()) if (n.startsWith(m.prefix.toUpperCase())) return { ...(m.density != null && { density: m.density }), ...(m.speed != null && { speed: m.speed }), ...(m.bold && { bold: true }) };
  return {};
}

// The lane wait after a sticker on this model (0 = none — every model but the XP-420B).
export function knownGapAfterMs(name: string | undefined | null): number {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return 0;
  for (const m of knownSource()) if (n.startsWith(m.prefix.toUpperCase())) return m.gapAfterMs ?? 0;
  return 0;
}

// A known printer: the D520BT (AIMO / Phomemo) or a listed model.
export function isKnownPrinter(p: Pick<BluetoothPrinterDevice, "name" | "model">): boolean {
  return p.model === "D520BT" || knownPrinterLang(p.name) !== null;
}

// ── THE WHITELIST (printer setup polish) — the scan list shows ONLY these ──────────────────
// The printers Jeff tested on paper. Brand = the row pill, model = the row's second line.
// Match = the native D520BT tag or a device-name prefix (case-insensitive). Anything else
// never appears for a seller ("Printer not listed? Contact Admin."); the admin "Show all"
// still lists every named device for Jeff's own testing.
export type KnownBrand = "AIMO" | "Flash" | "Niimbot" | "Xprinter";
export interface KnownPrinterInfo { brand: KnownBrand | (string & {}); model: string; approved?: true } // approved = an Admin-approved row (sql/160)
export const WHITELIST: readonly { prefix: string; brand: KnownBrand; model: string }[] = [
  { prefix: "D520BT", brand: "AIMO", model: "D520BT" },   // AIMO / Phomemo D520BT — scans as "D520BT-Z"
  { prefix: "Y41BT", brand: "Flash", model: "Y41BT" },    // FLASH LABEL Y41BT — scans as "Y41BT-0FC4_LE"
  { prefix: "B1 Pro-", brand: "Niimbot", model: "B1 Pro" }, // Niimbot B1 Pro — scans as "B1 Pro-I616030055"; same driver / 50 mm / sizes as the B1 (first match wins → before "B1-")
  { prefix: "B1-", brand: "Niimbot", model: "B1" },       // Niimbot B1 — scans as "B1-I603042141"
  { prefix: "B21-", brand: "Niimbot", model: "B21" },
  { prefix: "B203-", brand: "Niimbot", model: "B203" },
  { prefix: "B3S-", brand: "Niimbot", model: "B3S" },
  { prefix: "XP-420B", brand: "Xprinter", model: "XP-420B" }, // Xprinter XP-420B — scans as "XP-420B"; exact model only (no generic "XP-")
];
export function knownPrinterInfo(p: Pick<BluetoothPrinterDevice, "name" | "model" | "brand">): KnownPrinterInfo | null {
  if (p.model === "D520BT") return { brand: "AIMO", model: "D520BT" };
  const n = String(p.name || "").trim().toUpperCase();
  for (const w of WHITELIST) if (n && n.startsWith(w.prefix.toUpperCase())) return { brand: w.brand, model: w.model };
  if (p.brand === "niimbot") return { brand: "Niimbot", model: "" };
  const a = approvedPrinterFor(p.name); // an Admin-approved printer — only after every built-in rule said no
  if (a) return { brand: a.brand, model: a.model, approved: true };
  return null;
}

// ── ADMIN-APPROVED PRINTERS (sql/160 approved_printers, active rows) ─────────────────────────
// Jeff approves a tester's clean report in one tap; the row joins the whitelist with no build.
// The built-in list above ALWAYS wins: a name that any built-in rule knows (D520BT, a WHITELIST
// prefix, a BUILT_IN model, a Niimbot name) never reads an approved row. Empty list (not loaded,
// read failed, nothing approved) = exactly the built-in behaviour.
// shiftMm / flip (sql/161): move the sticker left on a printer that cuts its right edge / turn it 180°
export interface ApprovedPrinter { prefix: string; brand: string; model: string; lang: PrinterLang; shiftMm?: number; flip?: boolean }
// The layout fix for a SAVED printer of this name: an ACTIVE approved row's flip + shift (dots, 8 per mm);
// no row → no flip, no shift. Built-in names never read an approved row → always none for them.
export function approvedLayoutFor(name: string | undefined | null): { flip: boolean; shiftDots: number } {
  const a = approvedPrinterFor(name);
  const mm = a?.shiftMm ?? 0;
  return { flip: a?.flip === true, shiftDots: Number.isFinite(mm) && mm > 0 && mm <= 8 ? Math.round(mm * 8) : 0 };
}
let approvedList: readonly ApprovedPrinter[] = [];
const LANGS: readonly PrinterLang[] = ["tspl", "escpos", "cpcl"];
export function setApprovedPrinters(rows: readonly ApprovedPrinter[] | null): void {
  approvedList = (rows || []).filter((r) => r && String(r.prefix || "").trim().length >= 2 && LANGS.includes(r.lang));
}
export const approvedPrinters = (): readonly ApprovedPrinter[] => approvedList;
function builtInKnowsName(name: string | undefined | null): boolean {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return false;
  for (const w of WHITELIST) if (n.startsWith(w.prefix.toUpperCase())) return true;
  for (const m of knownSource()) if (n.startsWith(m.prefix.toUpperCase())) return true;
  return isNiimbotName(name);
}
// A name any built-in rule knows (the D520BT, a WHITELIST / BUILT_IN prefix, a Niimbot name) — never tuned (sql/230).
export const isBuiltInPrinterName = (name: string | undefined | null): boolean => builtInKnowsName(name);
export function approvedPrinterFor(name: string | undefined | null): ApprovedPrinter | null {
  if (!approvedList.length) return null;
  const n = String(name || "").trim().toUpperCase();
  if (!n || builtInKnowsName(name)) return null;
  for (const a of approvedList) if (n.startsWith(String(a.prefix).trim().toUpperCase())) return a;
  return null;
}

// v2 scan list = PRINTERS ONLY: a D520BT, a device advertising a printer service (native
// `likely`), or a device whose name is on the printer-name list. A paired laptop / headset /
// watch / heart-rate band is never a printer row.
export function isPrinterOnlyRow(p: Pick<BluetoothPrinterDevice, "model" | "likely" | "name" | "brand">): boolean {
  return p.model === "D520BT" || p.likely === true || p.brand === "niimbot" || matchesPrinterName(p.name);
}

// Brand that needs its own driver (vendor SDK) instead of a command language.
export type PrinterBrand = "niimbot";
export function brandOf(p: Pick<BluetoothPrinterDevice, "name" | "brand">): PrinterBrand | null {
  if (p.brand === "niimbot") return "niimbot";
  return isNiimbotName(p.name) ? "niimbot" : null;
}

// The gate: app_settings `printer_flow_v2` for everyone; admins and the test_printers
// list always. Everyone else keeps today's screen while the switch is off.
export function printerFlowV2Enabled(isAdmin: boolean, listed: boolean, switchOn: boolean): boolean {
  return isAdmin || listed || switchOn;
}
