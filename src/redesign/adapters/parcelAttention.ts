// BUILD 15 — Parcel Scan "needs attention" (display only). PURE helpers.
// One problem definition = what the saved list already flags on a row (red / orange border)
// and what the export already leaves out: a wrong store code, a full store, a restricted
// phone. Nothing here changes what counts as a problem, or any save / check / export step.
import { wrongStoreCode } from "./parcelScan";
import { exportedFrozenRefused } from "./parcelFrozenExport";
import { TEMP_FROZEN } from "./parcelFrozen";

// no_frozen (sql/142): a 冷凍 row whose store can't receive frozen — only while the frozen switch is
// on (frozenOn), so the top bar never says "All OK" above a red no_frozen row and the alert fires.
// no_frozen_exported (sql/157): a 冷凍 parcel that was ALREADY EXPORTED when its answer came and the
// store can't receive frozen — the seller must be told (same switch).
export type ProblemKind = "wrong_store" | "full" | "restricted" | "no_frozen" | "no_frozen_exported";
export interface ProblemRowLite {
  id: string;
  storeId?: string;
  storeCheckStatus?: string | null;
  storeFullStatus?: string | null;
  phoneCheckStatus?: string | null;
  tempLayer?: string;
  frozenStoreStatus?: string | null;
  status?: string;
}

// Same order as the export's reasons (splitScansForExport): wrong code, then full, then restricted, then no_frozen;
// an exported parcel's late no_frozen comes last.
export function problemOf(r: ProblemRowLite, frozenOn = false): ProblemKind | null {
  if (wrongStoreCode(r)) return "wrong_store";
  if (r.storeFullStatus === "full") return "full";
  if (r.phoneCheckStatus === "restricted") return "restricted";
  if (frozenOn && r.status !== "exported" && r.tempLayer === TEMP_FROZEN && r.frozenStoreStatus === "no_frozen") return "no_frozen";
  if (exportedFrozenRefused(r, frozenOn)) return "no_frozen_exported"; // exported before the answer came — the one problem an exported parcel can have
  return null;
}

export const problemRows = <T extends ProblemRowLite>(rows: T[], frozenOn = false): T[] => rows.filter((r) => problemOf(r, frozenOn) !== null);

// Problem rows not alerted yet (by id) — a parcel is alerted once, never again.
export const newProblemRows = <T extends ProblemRowLite>(alerted: ReadonlySet<string>, rows: T[], frozenOn = false): T[] =>
  problemRows(rows, frozenOn).filter((r) => !alerted.has(r.id));

// The store code shown in the alert: only a real 6-digit code (never a phone number or a name).
export const alertStoreCode = (r: ProblemRowLite): string => (/^\d{6}$/.test(r.storeId ?? "") ? (r.storeId as string) : "");

export const ATTN_TOAST_MS = 4000;
export const ATTN_VIBRATE_MS = 200;
export const ATTN_HIGHLIGHT_MS = 4000;
