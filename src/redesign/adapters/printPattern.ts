// P4 — pure LIVE-print-pattern helpers (kept out of the PrintPattern screen
// component file so react-refresh/only-export-components stays clean). The
// state shape + DEFAULT_PP live in screens/PrintPattern.tsx (pre-existing).
import { DEFAULT_PP, type PrintPatternState } from "../screens/PrintPattern";

// BACK-COMPAT (critical): readJSON does NOT merge — a pattern saved before P4
// has NO weight keys, and spreading it raw would read the primaries' bold as
// undefined (= falsy = a changed sticker for every existing seller). Merging
// over DEFAULT_PP restores the P3 hierarchy for every missing key.
export function normalizePp(raw: unknown): PrintPatternState {
  return { ...DEFAULT_PP, ...(raw && typeof raw === "object" ? (raw as Partial<PrintPatternState>) : {}) };
}

// P4 "Large print mode" — a PRESET, not a mode: one tap sets every size to 1.5x
// and every weight to Bold (the "malabo mata ko" seller); the caller stashes the
// previous values so the second tap restores them. Field toggles are untouched.
export function applyLargePreset(pp: PrintPatternState): PrintPatternState {
  return { ...pp, shopNameSize: 1.5, dateTimeSize: 1.5, buyerNumSize: 1.5, tiktokNameSize: 1.5, tiktokUserSize: 1.5, commentSize: 1.5, shopNameBold: true, buyerNumBold: true, tiktokNameBold: true, tiktokUserBold: true, commentBold: true };
}

// P4 honest fit hint — DELIBERATELY a simple threshold, not a TS mirror of the
// native vertical planner (the planner in Phomemo241Builder is the single
// authority; duplicating its math here would rot). Conservative rule: on a
// 40mm-tall label two 1.5x fields (the Large preset) or any 2x field can push
// past the budget; 50mm needs more; 60mm only at the extreme. The note's wording
// is conditional ("kapag hindi kasya") so a false-positive never lies — the
// planner shrinks ONLY when it truly doesn't fit.
export function patternFitHint(labelKey: string, pp: PrintPatternState): boolean {
  const h = Number(labelKey.match(/x(\d+)/)?.[1] || 60);
  const sizes = [
    pp.shopName ? pp.shopNameSize : 0,
    pp.buyerNum ? pp.buyerNumSize : 0,
    pp.tiktokName ? pp.tiktokNameSize : 0,
    pp.tiktokUser ? pp.tiktokUserSize : 0,
    pp.comment ? pp.commentSize : 0,
  ];
  const grown = sizes.filter((s) => s >= 1.5).length;
  const max = Math.max(0, ...sizes);
  if (h <= 40) return grown >= 2 || max >= 2;
  if (h <= 50) return grown >= 3 || max >= 2.5;
  return max >= 3;
}
