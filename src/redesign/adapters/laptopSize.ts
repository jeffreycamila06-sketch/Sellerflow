// Round 4 (item 5): the laptop sticker-size choice — the sizes a laptop can print, the one-time "Choose your sticker
// size" sheet's seen flag (printing.ts holds the CHOSEN flag the print path reads). Component-free so the sheet file
// keeps fast refresh.
export const LAPTOP_SIZES = ["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm", "50x30mm"];
export const LAPTOP_SIZE_SHEET_SEEN_KEY = "sfl_rd_laptop_size_sheet_seen";
export function laptopSizeSheetSeen(): boolean { try { return localStorage.getItem(LAPTOP_SIZE_SHEET_SEEN_KEY) === "1"; } catch { return false; } }
export function markLaptopSizeSheetSeen(): void { try { localStorage.setItem(LAPTOP_SIZE_SHEET_SEEN_KEY, "1"); } catch { /* ignore */ } }
export const sizeKeyOf = (psSize: string): string => psSize.match(/\d+x\d+/)?.[0] || "100x60";
