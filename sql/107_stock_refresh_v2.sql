-- ============================================================================
-- sql/107 — switch for Build 6 "Stock freshness" (stock_refresh_v2). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file (sql/106 is left for Build 4). Only the exact
-- string 'true' turns it on; anything else = off, and the app reads codes and stock once at
-- sign-in, as before. App-only: no server change, no Render deploy. An existing row is left as
-- it is. Rollback: sql/107_stock_refresh_v2_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('stock_refresh_v2', 'false')
on conflict (key) do nothing;
