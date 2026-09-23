-- 46 — SESSION-RPC v2 (H1 + H2): platform-safe sessions.
-- ⚠️ Apply via Supabase MCP (chat-Claude). Repo copy = doc MIRROR — do NOT auto-apply.
-- ⚠️ NO Render deploy (session RPCs are client↔DB only; server.js is not in this path).
-- BAWAL / untouched: buyer_number, legacy window_start/window_days, end_session logic,
-- the 7-day cap, and the session_status RUNNING definition (byte-identical to sql/43).
--
-- H1 (cross-platform buyer# guard): the session records WHICH platform it belongs to
-- (session_platform), so the client anchors switch-detection (buyer# → #1 on a real
-- platform change) on the SERVER session's platform instead of in-memory client flags.
--   • NULL session_platform = legacy/unknown → the client treats it as "continue" (NO
--     forced reset) → byte-identical behavior for every existing seller. All rows are
--     NULL after this additive ADD COLUMN (no backfill).
-- H2 (parallel-session race): start_session gains reuse-if-running, so two devices both
-- seeing "not running" converge on ONE session instead of minting parallel ids.
--
-- ⚠️ APPLY ORDER + PostgREST: both RPCs change SIGNATURE (session_status adds an OUT
-- column; start_session adds args) → each must be DROPPED then recreated (CREATE OR
-- REPLACE cannot change a return type or arg list), which also drops their GRANTs →
-- re-GRANT below. After apply, reload the PostgREST schema cache
-- (NOTIFY pgrst, 'reload schema';) so the new columns/args are exposed.
-- No-op proof for the fleet: ADD COLUMN is nullable/no-default (122 rows → NULL);
-- session_status running-clause is unchanged; a {p_days}-only call resolves to the new
-- start_session via defaults (p_platform=null, p_force=false → for a first-connect that
-- is "mint", identical to before; the only new behavior is reuse-if-running on a race).

-- ⚠️ ATOMIC APPLY: the whole file runs in ONE transaction (BEGIN…COMMIT) so the
-- DROP+CREATE of the two shared RPCs is all-or-nothing — a mid-file error rolls back
-- (no dropped-without-replacement function, no lost grants). PostgREST schema reload
-- fires only after COMMIT.
begin;

-- ── STEP 1 — additive column (nullable, no default, no backfill) ──────────────
alter table public.seller_session_config
  add column if not exists session_platform text;

-- ── STEP 2 — session_status(): ALSO return session_platform ───────────────────
-- RUNNING definition is BYTE-IDENTICAL to sql/43 (incl. the E2 `session_ended_at is
-- null` clause). Only a new OUT column is added. Explicit SECURITY INVOKER (audit).
drop function if exists public.session_status();
create function public.session_status()
  returns table(running boolean, session_id uuid, session_platform text)
  language sql
  stable
  security invoker
  set search_path to 'public'
as $$
  select
    ( c.current_session_id  is not null
      and c.session_started_at  is not null
      and c.session_window_days is not null
      and c.session_ended_at    is null
      and (now() at time zone 'Asia/Taipei')::date
          <= (c.session_started_at at time zone 'Asia/Taipei')::date
             + (c.session_window_days - 1) ) as running,
    c.current_session_id as session_id,
    c.session_platform   as session_platform
  from public.seller_session_config c
  where c.user_id = (select auth.uid());
$$;

-- ── STEP 3 — start_session(p_days, p_platform, p_force) ───────────────────────
-- Supersedes sql/43's start_session(smallint). DROP the old 1-arg signature FIRST so a
-- {p_days}-only call (old deployed clients) resolves unambiguously to the new function
-- via defaults. 1..7 validation kept. Explicit SECURITY INVOKER. Own-row auth.uid().
--   • p_force=false → H2 reuse-if-running: if a session is ALREADY running (SAME
--     ended-aware definition as session_status), RETURN the existing current_session_id
--     UNCHANGED — do NOT overwrite platform/started_at/window/ended. Converges a
--     two-device first-connect race onto one session (no orphaned parallel id).
--   • else (not running, or p_force=true) → mint a fresh uuid + stamp p_platform.
--     p_force=true is the CROSS-PLATFORM SWITCH path (born-ended-safe: the old session
--     may still be "running" but the switch intends a fresh #1 for the new platform).
-- session_ended_at is set NULL on every mint (symmetric with end_session; the sql/43
-- bug fix preserved). Never touches legacy window_start/window_days or buyer_number.
drop function if exists public.start_session(smallint);
create function public.start_session(p_days smallint, p_platform text default null, p_force boolean default false)
  returns uuid
  language plpgsql
  security invoker
  set search_path to 'public'
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_id       uuid := gen_random_uuid();
  v_existing uuid;
  v_running  boolean;
begin
  -- H2 — serialize this user's concurrent start_session calls (transaction-scoped
  -- advisory lock, released at COMMIT) BEFORE the reuse check, so two truly-simultaneous
  -- first-connects can't both read not-running and both mint. The second waits, then its
  -- reuse SELECT sees the first's committed session → returns it (converge). Works for a
  -- brand-new seller too (no row to FOR UPDATE). Mirrors sql/10 / sql/28's idiom.
  perform pg_advisory_xact_lock(hashtext('start_session_' || v_uid::text));

  if p_days is null or p_days < 1 or p_days > 7 then  -- 7-day ceiling (owner trial)
    raise exception 'invalid session length: %', p_days;
  end if;

  if not p_force then
    select
      c.current_session_id,
      ( c.current_session_id  is not null
        and c.session_started_at  is not null
        and c.session_window_days is not null
        and c.session_ended_at    is null
        and (now() at time zone 'Asia/Taipei')::date
            <= (c.session_started_at at time zone 'Asia/Taipei')::date
               + (c.session_window_days - 1) )
      into v_existing, v_running
      from public.seller_session_config c
     where c.user_id = v_uid;
    if v_running then
      return v_existing;   -- reuse-if-running: no overwrite, no platform change
    end if;
  end if;

  insert into public.seller_session_config
      (user_id, current_session_id, session_started_at, session_window_days, session_ended_at, session_platform)
  values
      (v_uid, v_id, now(), p_days, null, p_platform)
  on conflict (user_id) do update
    set current_session_id  = excluded.current_session_id,
        session_started_at  = excluded.session_started_at,
        session_window_days = excluded.session_window_days,
        session_ended_at    = null,
        session_platform    = excluded.session_platform,
        updated_at          = now();
  return v_id;
end;
$$;

-- ── STEP 4 — re-GRANT (DROP dropped the old grants) ───────────────────────────
revoke execute on function public.session_status()                             from public, anon;
revoke execute on function public.start_session(smallint, text, boolean)       from public, anon;
grant  execute on function public.session_status()                             to authenticated;
grant  execute on function public.start_session(smallint, text, boolean)       to authenticated;

commit;

-- Reload PostgREST's schema cache so the new OUT column / arg list are exposed
-- (only reached if the transaction above COMMITted).
notify pgrst, 'reload schema';

-- end_session() is UNTOUCHED (sql/43). Verify after apply:
--   SELECT * FROM public.session_status();                      -- 3 columns now
--   -- a {p_days}-only call still works (defaults): SELECT public.start_session(4::smallint);
