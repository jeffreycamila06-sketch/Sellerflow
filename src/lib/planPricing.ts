// Batch E (#14) — SINGLE SOURCE OF TRUTH for the NT$ plan price table and the
// amount→plan matcher. Before, the table lived in src/redesign/data.ts
// (PLAN_PRICE — feeds deriveMrr) while Admin.tsx carried its own threshold copy
// (matchPlan) with the same numbers re-typed; a price change in one place would
// silently desync the other (exactly the planWindow lesson of 2026-07-04).
//
// Real Taiwan prices: Basic NT$600 · Plus NT$1,000 · Pro NT$1,200 ·
// Master NT$1,700 (Basic raised 500→600 and Plus added 2026-07-28).
// "Business"/"Starter" are legacy labels still present on old rows — kept at
// their tier equivalents. Payments stay manual Wise+Telegram; this table is
// display/derivation only (MRR estimate, assign-amount matcher).

export const PLAN_PRICE: Record<string, number> = { Free: 0, Basic: 600, Plus: 1000, Pro: 1200, Master: 1700, Business: 1700, Starter: 600 };

// Amount → plan label for the admin "assign amount" flow. Thresholds ARE the
// tier prices above, checked price-descending (>=Master → Master, >=Pro → Pro,
// >=Plus → Plus, >=Basic → Basic). Plus sits between Pro and Basic so
// NT$1,000–1,199 maps to Plus, not Basic. Verbatim behavior of the old
// Admin.tsx local copy, extended for the middle tier.
export const matchPlan = (amt: string): string => {
  const a = +amt || 0;
  return a >= PLAN_PRICE.Master ? "Master" : a >= PLAN_PRICE.Pro ? "Pro" : a >= PLAN_PRICE.Plus ? "Plus" : a >= PLAN_PRICE.Basic ? "Basic" : "—";
};
