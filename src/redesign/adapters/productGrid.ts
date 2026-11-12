// Products list with pictures (approved preview, Nov 12 2026; only while the product-pictures
// switch is on — off = the list exactly as before). One CSS rule gives 2 cards per row on a phone
// (iPhone 390 / Android 412), 5 on a laptop (1280) and something in between on a tablet: a column
// is never narrower than 150 px and never narrower than a fifth of the row (so at most 5). The
// "- 1px" keeps rounding from ever dropping the 5th column.
export const PIC_GRID_GAP = 8;
export const PIC_GRID_MIN = 150;
export const PIC_GRID_MAX_COLS = 5;
export const PIC_GRID_PADDING = "10px 8px";
export const PIC_GRID_COLUMNS =
  `repeat(auto-fill, minmax(max(${PIC_GRID_MIN}px, calc((100% - ${(PIC_GRID_MAX_COLS - 1) * PIC_GRID_GAP}px) / ${PIC_GRID_MAX_COLS} - 1px)), 1fr))`;

// The same rule as a number (PURE): how many cards fit in a row of `width` px (the grid's
// content width, i.e. without its side padding). Mirrors the CSS above, for tests and reasoning.
export function picGridColumnCount(width: number): number {
  if (!(width > 0)) return 1;
  const min = Math.max(PIC_GRID_MIN, (width - (PIC_GRID_MAX_COLS - 1) * PIC_GRID_GAP) / PIC_GRID_MAX_COLS - 1);
  return Math.max(1, Math.floor((width + PIC_GRID_GAP) / (min + PIC_GRID_GAP)));
}

// The coloured placeholder letter for a product without a picture ("Hat" → "H").
export const placeholderLetter = (name: string): string => (Array.from((name || "").trim())[0] || "").toUpperCase();
