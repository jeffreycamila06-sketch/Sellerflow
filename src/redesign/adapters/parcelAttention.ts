// BUILD 15 — Parcel Scan "needs attention" (display only). PURE helpers.
// One problem definition = what the saved list already flags on a row (red / orange border)
// and what the export already leaves out: a wrong store code, a full store, a restricted
// phone. Nothing here changes what counts as a problem, or any save / check / export step.
import { wrongStoreCode } from "./parcelScan";

export type ProblemKind = "wrong_store" | "full" | "restricted";
export interface ProblemRowLite {
  id: string;
  storeId?: string;
  storeCheckStatus?: string | null;
  storeFullStatus?: string | null;
  phoneCheckStatus?: string | null;
}

// Same order as the export's reasons (splitScansForExport): wrong code, then full, then restricted.
export function problemOf(r: ProblemRowLite): ProblemKind | null {
  if (wrongStoreCode(r)) return "wrong_store";
  if (r.storeFullStatus === "full") return "full";
  if (r.phoneCheckStatus === "restricted") return "restricted";
  return null;
}

export const problemRows = <T extends ProblemRowLite>(rows: T[]): T[] => rows.filter((r) => problemOf(r) !== null);

// Problem rows not alerted yet (by id) — a parcel is alerted once, never again.
export const newProblemRows = <T extends ProblemRowLite>(alerted: ReadonlySet<string>, rows: T[]): T[] =>
  problemRows(rows).filter((r) => !alerted.has(r.id));

// The store code shown in the alert: only a real 6-digit code (never a phone number or a name).
export const alertStoreCode = (r: ProblemRowLite): string => (/^\d{6}$/.test(r.storeId ?? "") ? (r.storeId as string) : "");

export const ATTN_TOAST_MS = 4000;
export const ATTN_VIBRATE_MS = 200;
export const ATTN_HIGHLIGHT_MS = 4000;
