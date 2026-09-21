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

-- ── STEP 4 — widen start_session's length cap 5 → 7 AND make it SYMMETRIC with
-- end_session (reset session_ended_at = NULL on a new start) ────────────────────
-- ⚠️ SHARED RPC (supersedes sql/21's `> 5`). ADDITIVE / not narrowing: 1..5 stay valid
-- exactly as before; this only ALSO accepts 6..7. No non-owner UI sends 6/7 (the picker
-- is SESSION_OPTS [1..5] and clampWindowDays caps at 5), so every other seller's
-- behaviour is byte-identical. The auto-end formula is unchanged (session_status:
-- today <= start + (window_days-1)) → for 7 days a Monday start runs Mon..Sun, ending
-- the following Monday 00:00 Asia/Taipei.
-- 🔴 BUG FIX (2026-09-21): a new start MUST clear session_ended_at, or a fresh session
-- born after an End inherits the stale ended stamp and the E2 clause
-- (`and session_ended_at is null`) reports it as NOT running. Set it NULL in BOTH the
-- INSERT (new-row path) and the ON CONFLICT DO UPDATE (existing-row path). This is
-- symmetric with end_session (which sets it) and is a NO-OP for anyone who never used
-- End (session_ended_at was already NULL).
create or replace function public.start_session(p_days smallint)
  returns uuid
  language plpgsql
  set search_path to 'public'
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_days is null or p_days < 1 or p_days > 7 then  -- 7-day ceiling (was 5; owner trial 2026-09-21)
    raise exception 'invalid session length: %', p_days;
  end if;
  insert into public.seller_session_config
      (user_id, current_session_id, session_started_at, session_window_days, session_ended_at)
  values
      ((select auth.uid()), v_id, now(), p_days, null)
  on conflict (user_id) do update
    set current_session_id  = excluded.current_session_id,
        session_started_at  = excluded.session_started_at,
        session_window_days = excluded.session_window_days,
        session_ended_at    = null,                     -- BUG FIX: a fresh Start is never "ended"
        updated_at          = now();
  return v_id;
end;
$$;
