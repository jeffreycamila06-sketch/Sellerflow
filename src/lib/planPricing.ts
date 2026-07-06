// Batch E (#14) — SINGLE SOURCE OF TRUTH for the NT$ plan price table and the
// amount→plan matcher. Before, the table lived in src/redesign/data.ts
// (PLAN_PRICE — feeds deriveMrr) while Admin.tsx carried its own threshold copy
// (matchPlan) with the same numbers re-typed; a price change in one place would
// silently desync the other (exactly the planWindow lesson of 2026-07-04).
//
// Real Taiwan prices (Phase 5b decision): Basic NT$500 · Pro NT$1,200 ·
// Master NT$1,700. "Business"/"Starter" are legacy labels still present on old
// rows — kept at their tier equivalents. Payments stay manual Wise+Telegram;
// this table is display/derivation only (MRR estimate, assign-amount matcher).

export const PLAN_PRICE: Record<string, number> = { Free: 0, Basic: 500, Pro: 1200, Master: 1700, Business: 1700, Starter: 500 };

// Amount → plan label for the admin "assign amount" flow. Thresholds ARE the
// tier prices above (>=Master → Master, >=Pro → Pro, >=Basic → Basic).
// Verbatim behavior of the old Admin.tsx local copy.
export const matchPlan = (amt: string): string => {
  const a = +amt || 0;
  return a >= PLAN_PRICE.Master ? "Master" : a >= PLAN_PRICE.Pro ? "Pro" : a >= PLAN_PRICE.Basic ? "Basic" : "—";
};
