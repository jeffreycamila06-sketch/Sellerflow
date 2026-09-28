-- 59 — "Same price for all items": ON/OFF toggle with a REMEMBERED price.
-- Adds `enabled` to seller_same_price (sql/58). The override applies only when
-- enabled = true AND same_price > 0. Toggling OFF keeps same_price (the seller's
-- price is remembered for next time); a fresh row is enabled=false by default.
-- Additive + nullable-safe: existing rows default to enabled=false (off), so no
-- seller is silently switched on. Production App.tsx never reads this table.
alter table public.seller_same_price
  add column if not exists enabled boolean not null default false;

-- ROLLBACK: alter table public.seller_same_price drop column enabled;
