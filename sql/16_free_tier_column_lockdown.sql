-- 16_free_tier_column_lockdown.sql
-- SECURITY FIX S1 (audit Batch A) — close the free-tier cap bypass.
--
-- ✅ APPLIED to production by chat-Claude (Supabase MCP) 2026-07-11. Verified
--    UPDATE column grants on seller_profiles: anon=0, authenticated=13 (the list
--    below), postgres/service_role=19 (all columns). This file is the repo mirror
--    of the live state.
--
-- PROBLEM: a free seller can bypass the 100-order cap with a direct PostgREST
-- call that resets their own counter:
--   PATCH /rest/v1/seller_profiles?auth_user_id=eq.<self> {"free_orders_count":0}
-- RLS allows the own-row UPDATE and the seller_profiles_on_update trigger reverts
-- plan/role/etc for non-admins but NOT the free-tier columns.
--
-- ⚠️ WHY A COLUMN-ONLY REVOKE DID NOT WORK (chat-Claude found this on apply):
--   `authenticated`/`anon` hold a TABLE-LEVEL UPDATE grant on seller_profiles.
--   A table-level UPDATE privilege lets the role update ANY column, so a bare
--   `REVOKE UPDATE (free_orders_count, …)` is overridden and has no effect.
--
-- CORRECT FIX: revoke the broad table-level UPDATE, then re-grant UPDATE on ONLY
-- the columns the app legitimately updates. The three free-tier columns are left
-- OUT of the grant, so no API-role statement can ever SET them.
--
-- EXHAUSTIVE ENUMERATION (read-only, every seller_profiles write in the repo —
-- all funnel through src/accountDb.ts; server.js only SELECTs):
--   userToRow (upsertUser, seller self-edit): full_name, store_name, phone,
--       tiktok, facebook, connected_accounts, updated_at
--   planRow (upsertUser includePlan, ADMIN): plan, plan_status, plan_expiry,
--       trial_started_at, role
--   adminUpdatePlan (ADMIN): plan, plan_status, plan_expiry, trial_started_at,
--       role, updated_at
--   adminUpdateContactNote (ADMIN): admin_contact_note, updated_at
--   createMyProfile is an INSERT (separate privilege, unaffected).
--   → UNION of UPDATEd columns = the 13 in the GRANT below.
--
-- Columns deliberately EXCLUDED from the grant:
--   free_orders_count, free_cycle_started_at, free_warned_at  ← THE FIX
--   auth_user_id, email, created_at  ← app never UPDATEs them (defense-in-depth;
--       email/auth_user_id are also reverted by the update trigger).
--
-- plan / role / plan_status / plan_expiry / trial_started_at ARE granted because
-- ADMINS update them through the same `authenticated` role (there is no separate
-- admin DB role); the seller_profiles_on_update trigger reverts them for
-- non-admins, so granting the column is safe.
--
-- WHY ENFORCEMENT STILL WORKS (verified): every function that WRITES the free-tier
-- columns is SECURITY DEFINER owned by postgres — check_and_increment_free_order,
-- free_tier_mark_warned, seller_profiles_on_insert — so they keep the privilege
-- after the revoke and are unaffected by the API-role grants. No client/server
-- code writes these columns.
--
-- REVERSIBLE:  grant update on public.seller_profiles to authenticated, anon;

-- ── BEFORE (expect a broad table-level UPDATE grant, no column list) ──
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name='seller_profiles'
--   and grantee in ('authenticated','anon') and privilege_type='UPDATE';

-- ── THE FIX ──
-- 1) drop the broad table-level UPDATE that overrides column grants.
revoke update on public.seller_profiles from authenticated, anon;

-- 2) re-grant UPDATE on ONLY the app-updated columns (to authenticated only —
--    the app never updates seller_profiles as anon; RLS requires auth.uid()).
grant update (
  full_name,
  store_name,
  phone,
  tiktok,
  facebook,
  connected_accounts,
  plan,
  plan_status,
  plan_expiry,
  trial_started_at,
  role,
  admin_contact_note,
  updated_at
) on public.seller_profiles to authenticated;

-- ── AFTER (verify) ──
-- (a) authenticated has UPDATE on EXACTLY the 13 columns above, and NOT on
--     free_orders_count / free_cycle_started_at / free_warned_at / auth_user_id /
--     email / created_at:
-- select grantee, column_name
-- from information_schema.column_privileges
-- where table_schema='public' and table_name='seller_profiles'
--   and grantee='authenticated' and privilege_type='UPDATE'
-- order by column_name;
--
-- (b) neither role retains a table-level UPDATE (this query returns 0 rows):
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name='seller_profiles'
--   and grantee in ('authenticated','anon') and privilege_type='UPDATE';
--
-- (c) functional smoke test — a normal seller profile save still works
--     (updates only granted columns), and a counter-reset attempt now fails:
--     UPDATE seller_profiles SET free_orders_count = 0 WHERE auth_user_id = auth.uid();
--     → ERROR: permission denied for column free_orders_count.
