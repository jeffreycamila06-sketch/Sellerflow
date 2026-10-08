-- 86 ROLLBACK — restores start_session to its sql/46 body (byte-identical function body).
-- Same signature → create or replace, NO drop. Safe to run alone and twice.

-- ── SECTION 1 — start_session as in sql/46 ─────────────────────────────────────
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

-- ── SECTION 2 — grants (as in sql/46) ──────────────────────────────────────────
revoke execute on function public.start_session(smallint, text, boolean) from public, anon;
grant  execute on function public.start_session(smallint, text, boolean) to authenticated;
