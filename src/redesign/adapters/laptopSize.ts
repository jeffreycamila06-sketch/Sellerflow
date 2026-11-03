// Round 4/5 (item 5): the laptop sticker-size choice — the sizes a laptop can print, the "Choose your sticker size"
// sheet's seen flag, the cross-tab apply. printing.ts holds the CHOSEN flag the print path reads.
// Component-free so the sheet file keeps fast refresh.
export const LAPTOP_SIZES = ["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm", "50x30mm"];
// Round 5 (item 4): "Later" / tap outside / Escape = ask again on the NEXT app open, not never → the seen flag is per
// SESSION (sessionStorage), mirrored in memory (item 3: storage blocked → still at most once per session).
export const LAPTOP_SIZE_SHEET_SEEN_KEY = "sfl_rd_laptop_size_sheet_seen";
let seenMem = false;
export function laptopSizeSheetSeen(): boolean { if (seenMem) return true; try { return sessionStorage.getItem(LAPTOP_SIZE_SHEET_SEEN_KEY) === "1"; } catch { return false; } }
export function markLaptopSizeSheetSeen(): void { seenMem = true; try { sessionStorage.setItem(LAPTOP_SIZE_SHEET_SEEN_KEY, "1"); } catch { /* ignore */ } }
export function __resetLaptopSizeSheetSeen(): void { seenMem = false; try { sessionStorage.removeItem(LAPTOP_SIZE_SHEET_SEEN_KEY); } catch { /* ignore */ } }
export const sizeKeyOf = (psSize: string): string => psSize.match(/\d+x\d+/)?.[0] || "100x60";
// Round 5 (item 4): another tab chose a size → this tab applies it. PURE: given a storage event's key/value and the
// printer settings JSON the other tab saved, says whether the choice landed and which size it carries.
export function laptopChoiceFromStorage(chosenKey: string, e: { key: string | null; newValue: string | null }, printerJson: string | null): { chosen: boolean; psSize?: string } {
  if (e.key !== chosenKey || e.newValue !== "1") return { chosen: false };
  try { const p = JSON.parse(printerJson || "") as { psSize?: unknown }; return { chosen: true, ...(typeof p?.psSize === "string" ? { psSize: p.psSize } : {}) }; } catch { return { chosen: true }; }
}
// Round 5 (item 4): the sheet must never steal focus from a typing field during a live.
export const isTypingTarget = (el: Element | null): boolean => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable === true);
