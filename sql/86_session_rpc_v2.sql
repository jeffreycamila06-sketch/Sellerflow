-- 86 — SESSION-RPC v2 hardening (on top of sql/46): reuse a running session only when its
-- platform matches.
-- Repo copy = doc MIRROR. Applied by the owner/reviewer, NOT by Claude. NO Render deploy
-- (database RPC + web only; server.js is not in this path).
--
-- What changes: start_session(p_days, p_platform, p_force) with p_force = false and a
-- session already running. sql/46 always returned the running id. Now it returns it only
-- when the running session's platform equals p_platform, or either one is NULL; two
-- DIFFERENT known platforms raise 'session_switch_needed' (nothing is written). Case it
-- closes: device A first-connects TikTok, device B first-connects Facebook a moment later
-- (B saw "not running") → before: B silently joined A's TikTok session (mixed numbering);
-- now: B gets the switch confirm.
--
-- Unchanged: the signature (so NO drop function — create or replace keeps the grants), the
-- p_force = true path, the not-running mint, the 1..7 check, the advisory lock,
-- session_status(), end_session(). A TikTok-only seller always sends 'TikTok' and only ever
-- has 'TikTok' or NULL stored → always the reuse branch → identical to sql/46.
-- Old clients that send no p_platform (NULL) → reuse, identical to sql/46.
--
-- Every section is safe to run alone and twice. Rollback: sql/86_session_rpc_v2_rollback.sql.

-- ── SECTION 1 — start_session with the platform-aware reuse ────────────────────
create or replace function public.start_session(p_days smallint, p_platform text default null, p_force boolean default false)
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
  v_platform text;
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
      c.session_platform,
      ( c.current_session_id  is not null
        and c.session_started_at  is not null
        and c.session_window_days is not null
        and c.session_ended_at    is null
        and (now() at time zone 'Asia/Taipei')::date
            <= (c.session_started_at at time zone 'Asia/Taipei')::date
               + (c.session_window_days - 1) )
      into v_existing, v_platform, v_running
      from public.seller_session_config c
     where c.user_id = v_uid;
    if v_running then
      -- sql/86: reuse ONLY when the running session's platform is the same as, or either
      -- side does not know, the connecting platform. Two different known platforms =
      -- another device started a session on another platform → "switch needed" (the
      -- client shows the switch confirm, which force-mints). Nothing is written.
      if v_platform is null or p_platform is null or v_platform = p_platform then
        return v_existing;   -- reuse-if-running: no overwrite, no platform change
      end if;
      raise exception 'session_switch_needed'
        using hint = 'running session platform differs; confirm the switch (p_force=true)';
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

-- ── SECTION 2 — grants (unchanged from sql/46; re-stated so this file is complete) ──
revoke execute on function public.start_session(smallint, text, boolean) from public, anon;
grant  execute on function public.start_session(smallint, text, boolean) to authenticated;
