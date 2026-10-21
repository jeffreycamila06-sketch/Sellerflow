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
export const PRINTER_NAME_PREFIXES: readonly string[] = [
  // Niimbot B-series 50 mm models (vendor SDK driver — see isNiimbotName). The narrow-head
  // D11/D110/D101/H1S/B18 are NOT listed for now: they take the normal "not found / show all" path.
  "B1-", "B21-", "B203-", "B3S-",
  // Xprinter / generic receipt + label printers ("HM-" and "RP" were dropped: they match non-printers)
  "XP-", "Xprinter", "Printer", "PRT", "PT-", "MPT", "GP-",
  // Phomemo M-series + Q30/T02
  "M02", "M110", "M120", "M200", "M220", "M221", "Q30", "T02",
  // HPRT, Munbyn, Rongta (RP), Gprinter, Zjiang
  "HPRT", "Munbyn", "Gprinter", "Zjiang",
];
export const NIIMBOT_NAME_PREFIXES: readonly string[] = ["B1-", "B21-", "B203-", "B3S-"];

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
interface KnownModel { prefix: string; lang: PrinterLang }
const BUILT_IN: KnownModel[] = [
  { prefix: "Y41BT", lang: "tspl" }, // FLASH LABEL Y41BT — printed a clean TSPL sticker on the owner's iPhone (Oct 21)
];
let knownSource: () => KnownModel[] = () => BUILT_IN;
export function __setKnownSource(fn: (() => KnownModel[]) | null): void { knownSource = fn ?? (() => BUILT_IN); }

// The language a known model prints with, by device name; null = not in the list.
export function knownPrinterLang(name: string | undefined | null): PrinterLang | null {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return null;
  for (const m of knownSource()) if (n.startsWith(m.prefix.toUpperCase())) return m.lang;
  return null;
}

// "✓ Works with SFL": the D520BT (AIMO / Phomemo) or a listed model. Everything else is "New".
export function isKnownPrinter(p: Pick<BluetoothPrinterDevice, "name" | "model">): boolean {
  return p.model === "D520BT" || knownPrinterLang(p.name) !== null;
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

// New printer: TSPL first (the D520BT/Y41BT language), ESC/POS second, CPCL third; then give up.
// CPCL only when the app build can STORE it (`cpclSupported` — the settings screen passes
// hasNiimbotBridge(), the marker of a build new enough to know the third language); an older
// build stops after ESC/POS instead of saving a language it would silently turn into tspl.
export const LANG_ORDER: readonly PrinterLang[] = ["tspl", "escpos", "cpcl"];
export function nextLang(tried: PrinterLang, cpclSupported = true): PrinterLang | null {
  const i = LANG_ORDER.indexOf(tried);
  const n = i >= 0 && i + 1 < LANG_ORDER.length ? LANG_ORDER[i + 1] : null;
  return n === "cpcl" && !cpclSupported ? null : n;
}

// The gate: app_settings `printer_flow_v2` for everyone; admins and the test_printers
// list always. Everyone else keeps today's screen while the switch is off.
export function printerFlowV2Enabled(isAdmin: boolean, listed: boolean, switchOn: boolean): boolean {
  return isAdmin || listed || switchOn;
}
