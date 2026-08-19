-- 21 — EXPLICIT SESSION MODEL: session lifecycle RPCs (sub-step 2).
-- ⚠️ Apply via Supabase MCP (chat-Claude). This repo copy is the doc MIRROR.
-- ⚠️ These are DB functions (NOT server.js / Render). No Render deploy.
--
-- Depends on sql/20 (session_id columns) being applied first.
--
-- WHY server-side: the owner LOCKED "server-authoritative today Taipei for the
-- ended-check — do NOT compute it from the device clock." The ended-check is
-- f(today, session_started_at, window_days); to keep it device-clock-free BOTH
-- "today" AND the session start must come from the server. So:
--   • session_status()  computes the ended-check entirely server-side (server
--     now() at Asia/Taipei), returning just running + the session id.
--   • start_session()   stamps session_started_at = server now() (not device
--     time), so the start is server-authoritative too.
-- Both are SECURITY INVOKER + own-row via auth.uid() (RLS already scopes
-- seller_session_config to user_id = auth.uid()); no SECURITY DEFINER needed.
-- Neither touches buyer_number, orders, window_start, or window_days.

-- ── session_status(): is the caller's current session still running? ─────────
-- running = current_session_id set AND today(Taipei) <= start(Taipei) + (N-1).
-- Returns the stored current_session_id regardless (the client only RESUMES when
-- running=true). No config row → no rows returned → client treats as not running.
create or replace function public.session_status()
returns table(running boolean, session_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ( c.current_session_id  is not null
      and c.session_started_at  is not null
      and c.session_window_days is not null
      and (now() at time zone 'Asia/Taipei')::date
          <= (c.session_started_at at time zone 'Asia/Taipei')::date
             + (c.session_window_days - 1) ) as running,
    c.current_session_id as session_id
  from public.seller_session_config c
  where c.user_id = (select auth.uid());
$$;

-- ── start_session(p_days): create a NEW session instance (server-authoritative)
-- Generates a fresh uuid, stamps session_started_at = server now(), stores the
-- chosen length. Upsert on the caller's own row. Deliberately does NOT write
-- window_start / window_days (the OLD model's fields stay untouched for old-client
-- coexistence; on a brand-new config row they take their column defaults).
create or replace function public.start_session(p_days smallint)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_days is null or p_days < 1 or p_days > 4 then
    raise exception 'invalid session length: %', p_days;
  end if;
  insert into public.seller_session_config
      (user_id, current_session_id, session_started_at, session_window_days)
  values
      ((select auth.uid()), v_id, now(), p_days)
  on conflict (user_id) do update
    set current_session_id  = excluded.current_session_id,
        session_started_at  = excluded.session_started_at,
        session_window_days = excluded.session_window_days,
        updated_at          = now();
  return v_id;
end;
$$;

-- EXECUTE: authenticated only (Postgres grants to PUBLIC by default → revoke it).
revoke execute on function public.session_status()        from public, anon;
revoke execute on function public.start_session(smallint) from public, anon;
grant  execute on function public.session_status()        to authenticated;
grant  execute on function public.start_session(smallint) to authenticated;

-- Verify after apply:
--   -- as an authed user (googletest): before any session → running=false / no row
--   SELECT * FROM public.session_status();
--   -- create one, then re-check:
--   SELECT public.start_session(4::smallint);          -- returns a uuid
--   SELECT * FROM public.session_status();             -- running=true, session_id=that uuid
--   SELECT current_session_id, session_started_at, session_window_days,
--          window_start, window_days                   -- window_* must be UNCHANGED
--   FROM public.seller_session_config WHERE user_id = auth.uid();
--   -- confirm SECURITY INVOKER + grants:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('session_status','start_session');   -- prosecdef=false (INVOKER)
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.session_status();
--   DROP FUNCTION IF EXISTS public.start_session(smallint);
