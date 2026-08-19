-- 20 — EXPLICIT SESSION MODEL: additive session_id columns (SCHEMA ONLY).
-- ⚠️ Apply via Supabase MCP (chat-Claude). This repo copy is the doc MIRROR.
--
-- Purpose (approved "pick-session-on-Connect, locked-until-ended,
-- new-session-resets-buyer#" model — sub-step 1 of N): make explicit-session
-- columns EXIST. NO behavior change ships in this step — no app code reads or
-- writes these columns yet (verified: grep of src/ for session_id /
-- current_session_id = 0 hits at 1fa1f74). session_id is assigned by the APP in
-- a LATER sub-step; this migration ONLY creates the columns.
--
-- The model (recap): each new live session gets its own session_id (uuid).
-- buyer_number becomes scoped per (user_id, session_id) — continuous within one
-- session, reset only when a NEW session starts. The session's start + length
-- are frozen for the life of the session (their mid-run mutation via
-- window_start today is the bug that hid orders).
--
-- ── WHAT TO ADD vs REUSE (the design decision) ──────────────────────────────
-- ADD 1 column to live_session_orders:
--   • session_id uuid NULL — which session instance an order belongs to.
-- ADD 3 columns to seller_session_config (do NOT reuse window_start/window_days
-- for the new model's start/length — see rationale):
--   • current_session_id  uuid        NULL — the seller's ACTIVE session instance.
--   • session_started_at  timestamptz NULL — the session's IMMUTABLE start.
--   • session_window_days smallint    NULL — the session's IMMUTABLE length (1..4).
-- REUSE nothing for the new model. window_start / window_days are LEFT UNTOUCHED
-- (not dropped, not altered) — they remain the OLD model's fields so old (not-yet-
-- reloaded) thin-shell clients keep working during rollout coexistence.
--
-- WHY dedicated columns instead of "freeze window_start/window_days":
--   During rollout, old clients still MUTATE window_start/window_days (setWindowDays
--   / ensureWindowOpen → seller_session_config upsert, useSessionWindow.ts:273).
--   If the new model reused those, a lingering old client on a second device could
--   move the "immutable" start/length mid-session → the exact hidden-orders /
--   buyer#-reset class we are eliminating. Dedicated columns that old clients never
--   write make the new session's start+length TRULY immutable regardless of any
--   straggler old client. The columns are nullable with no default → free to add.
--
-- ── ADDITIVE-SAFETY (safe to apply on the live 30k-row table, sellers live) ──
--   • Every column is NULLABLE with NO DEFAULT → ALTER TABLE ADD COLUMN is a
--     CATALOG-ONLY change: Postgres does NOT rewrite the table and does NOT scan
--     existing rows. Existing rows are untouched — session_id / current_session_id
--     etc. read as NULL on every legacy row. NO buyer_number is changed.
--   • Honest lock note: ADD COLUMN still takes a brief ACCESS EXCLUSIVE lock to
--     update the catalog, held only for that instant (no rewrite, no row scan), so
--     concurrent reads/writes queue for at most a few ms. This is safe with active
--     sessions — it is NOT a long-held or table-rewriting lock.
--   • NO backfill, NO UPDATE/DELETE of existing rows, NO NOT NULL, NO type change
--     of any existing column, NO default.
--   • Existing RLS is column-agnostic (per-row user_id = auth.uid()) → the new
--     columns are already covered; NO new policy needed. The set_session_date_taipei
--     BEFORE-INSERT trigger and the billing `orders` free-cap ledger are UNTOUCHED.
--   • NO index in this step (an index on an all-NULL column is useless until data
--     exists). The (user_id, session_id) load index is a LATER sub-step, added
--     with the load change that queries by it — kept out of this schema-only step.
--   • IF NOT EXISTS on every column → re-running the migration is a safe no-op.

alter table public.live_session_orders
  add column if not exists session_id uuid null;

alter table public.seller_session_config
  add column if not exists current_session_id  uuid        null,
  add column if not exists session_started_at  timestamptz null,
  add column if not exists session_window_days smallint    null;

-- Verify after apply:
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public'
--     AND ( (table_name='live_session_orders'  AND column_name='session_id')
--        OR (table_name='seller_session_config' AND column_name IN
--            ('current_session_id','session_started_at','session_window_days')) )
--   ORDER BY table_name, column_name;
--   -- expect all is_nullable=YES, column_default=NULL.
--   SELECT count(*) FROM public.live_session_orders WHERE session_id IS NOT NULL;
--   -- expect 0 (no backfill; every legacy row stays NULL).
--
-- Rollback (safe — nothing reads these yet):
--   ALTER TABLE public.live_session_orders   DROP COLUMN IF EXISTS session_id;
--   ALTER TABLE public.seller_session_config DROP COLUMN IF EXISTS current_session_id;
--   ALTER TABLE public.seller_session_config DROP COLUMN IF EXISTS session_started_at;
--   ALTER TABLE public.seller_session_config DROP COLUMN IF EXISTS session_window_days;
