// Printer setup v2 — "no switch, fewer taps". Pure helpers for the Printer settings scan list:
// which rows are printers, which are already known to work (and in what command language),
// and the order the two languages are tried on a new printer.
import type { BluetoothPrinterDevice } from "./printerBridge";
import type { PrinterLang } from "./savedPrinter";

export type { PrinterLang };

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

// v2 scan list = PRINTERS ONLY: a D520BT, or a device advertising a printer service
// (native `likely`). A paired laptop / headset is never a printer row.
export function isPrinterOnlyRow(p: Pick<BluetoothPrinterDevice, "model" | "likely">): boolean {
  return p.model === "D520BT" || p.likely === true;
}

// New printer: TSPL first (the D520BT/Y41BT language), ESC/POS second; then give up.
export const LANG_ORDER: readonly PrinterLang[] = ["tspl", "escpos"];
export function nextLang(tried: PrinterLang): PrinterLang | null {
  const i = LANG_ORDER.indexOf(tried);
  return i >= 0 && i + 1 < LANG_ORDER.length ? LANG_ORDER[i + 1] : null;
}

// The gate: app_settings `printer_flow_v2` for everyone; admins and the test_printers
// list always. Everyone else keeps today's screen while the switch is off.
export function printerFlowV2Enabled(isAdmin: boolean, listed: boolean, switchOn: boolean): boolean {
  return isAdmin || listed || switchOn;
}
