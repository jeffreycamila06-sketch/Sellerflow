-- EXPLICIT "End Session" (E2) — owner-gated feature (frontend allowlist), additive DB.
-- Lets a seller close a running session early so the NEXT Start begins buyer# at 1.
-- Applied in THREE ordered steps; step 3 (the ONE shared-function change) is applied
-- ONLY after the dry-run no-op proof (all existing rows have session_ended_at IS NULL,
-- so session_status() returns byte-identical results for every seller).
--
-- Supabase-only. NOTHING here requires a Render restart. Frontend UI is Vercel.

-- ── STEP 1 — additive column (safe: nullable, no default, no backfill) ────────
alter table public.seller_session_config
  add column if not exists session_ended_at timestamptz;

-- ── STEP 2 — end_session() RPC (NEW function; only the owner's UI ever calls it) ─
-- SECURITY INVOKER + own-scoped (auth.uid()): a caller can only end THEIR OWN row
-- (RLS update policy is user_id = auth.uid()). Sets current_session_id = NULL (so
-- session_status is already not-running by the first condition) AND stamps
-- session_ended_at = now() (audit trail + the belt-and-suspenders clause below).
create or replace function public.end_session()
  returns void
  language sql
  security invoker
  set search_path to 'public'
as $$
  update public.seller_session_config
     set current_session_id = null,
         session_ended_at    = now(),
         updated_at          = now()
   where user_id = (select auth.uid());
$$;

-- ── STEP 3 — session_status() : add ONLY the "and c.session_ended_at is null" clause
-- ⚠️ SHARED FUNCTION — every seller calls this on Connect. Apply ONLY after the
-- no-op proof. The clause is the SOLE difference from the live definition; for all
-- 122 existing rows session_ended_at IS NULL → the clause is a tautology → identical
-- output. (Kept for defense-in-depth even though end_session also nulls
-- current_session_id, which already makes the first condition false.)
create or replace function public.session_status()
  returns table(running boolean, session_id uuid)
  language sql
  stable
  set search_path to 'public'
as $$
  select
    ( c.current_session_id  is not null
      and c.session_started_at  is not null
      and c.session_window_days is not null
      and c.session_ended_at    is null            -- NEW (E2): the only added clause
      and (now() at time zone 'Asia/Taipei')::date
          <= (c.session_started_at at time zone 'Asia/Taipei')::date
             + (c.session_window_days - 1) ) as running,
    c.current_session_id as session_id
  from public.seller_session_config c
  where c.user_id = (select auth.uid());
$$;
