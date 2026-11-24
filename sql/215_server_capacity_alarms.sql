-- ═════════════════════════════════════════════════════════════════════════════
-- 215 — SERVER-CAPACITY ALARMS to the Admin's Telegram (2026-11-24, Jeff).
-- NOT APPLIED. chat-Claude applies it after Jeff's go. Rollback: 215_server_capacity_alarms_rollback.sql.
--
-- Three small things:
--   1. public.server_runs — one row per run of the Render server (a heartbeat a minute + "ended cleanly").
--      The server uses it to tell a clean stop (deploy, restart) from a crash / a kill for memory, and to
--      remember across a restart what level the Admin was last told (server/capacityAlarm.js).
--      Numbers and times only. No browser access at all (service role only).
--   2. app_settings.server_alarms_enabled — the switch. Created 'true'. Exactly 'false' = no capacity alarm
--      is sent, by the server or by the database. A missing row or any other text = alarms on.
--   3. THE DATABASE-CONNECTIONS ALARM, sent by the database itself (like sql/195, and with sql/195's own
--      send function and Vault secrets — sql/195 must be applied; it is, since 2026-11-21):
--        every 5 minutes pg_cron counts the client connections (pg_stat_activity, backend_type
--        'client backend') against max_connections.
--        WARNING  at 70 % or more on 2 checks in a row   → one message
--        OK       under 60 % on 3 checks in a row        → one message, only if the warning reached Telegram
--        A send that fails is tried again at the next checks, 3 tries in all, the 2nd and 3rd ending with
--        " (sent again)" — a warning only while the reading is still at 60 % or more. A warning that never
--        got through is tried again once an hour while it still holds.
--      Texts (numbers only):
--        ⚠️ SellerFlowLive database / Connections: 64 sa 90 (71%) / Wala pang problema, pero sumisikip na.
--        ✅ SellerFlowLive database — ok na ulit / Connections: 31 sa 90 (34%).
--
-- OFF: update public.app_settings set value = 'false' where key = 'server_alarms_enabled';
--      (or, the database alarm alone:  select cron.unschedule('db-capacity-alarm');)
-- LOOK: select level, streak, told, last_used, last_max, last_result, updated_at from public.db_capacity_state;
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '2s';

do $guard$
begin
  if to_regprocedure('public.parcel_silence_send(text,integer)') is null then
    raise exception 'sql/215: sql/195 (parcel_silence_send) is not applied — nothing was changed';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'sql/215: pg_cron is missing — nothing was changed';
  end if;
  if to_regclass('public.server_runs') is not null or to_regclass('public.db_capacity_state') is not null then
    raise exception 'sql/215: its tables already exist — nothing was changed';
  end if;
end
$guard$;

-- ── 1. one row per run of the server ─────────────────────────────────────────
create table public.server_runs (
  run_id         text primary key check (run_id ~ '^[0-9a-f]{8,32}$'),
  started_at     timestamptz not null,
  heartbeat_at   timestamptz not null,
  lives          integer  not null default 0 check (lives between 0 and 1000000),
  mem_pct        smallint not null default 0 check (mem_pct between 0 and 999),
  told_level     text     not null default 'normal' check (told_level in ('normal','warning','danger')),
  commit         text     check (commit is null or commit ~ '^[0-9a-f]{7}$'),
  ended_clean_at timestamptz,          -- the server was asked to stop and said so
  alarmed_at     timestamptz           -- an unclean end of this run was reported
);
create index server_runs_heartbeat_idx on public.server_runs (heartbeat_at);
alter table public.server_runs enable row level security;      -- no policy: no browser access
revoke all on public.server_runs from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.server_runs to service_role;

-- ── 2. the switch ────────────────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('server_alarms_enabled', 'true')
on conflict (key) do nothing;

-- ── 3. the database-connections alarm ────────────────────────────────────────
create table public.db_capacity_state (
  id           boolean primary key default true check (id),
  level        text not null default 'normal' check (level in ('normal','warning')),
  streak       smallint not null default 0 check (streak between 0 and 100),   -- checks in a row pointing away from the level
  told         boolean not null default false,                                  -- the warning of this episode reached Telegram
  pending      text check (pending in ('warning','ok')),                        -- a message still to send
  pending_try  smallint not null default 0 check (pending_try between 0 and 3),
  last_try_at  timestamptz,
  last_used    integer,
  last_max     integer,
  last_result  text check (last_result is null or last_result ~ '^[a-z0-9_]{1,24}$'),
  updated_at   timestamptz not null default now()
);
insert into public.db_capacity_state (id) values (true);
alter table public.db_capacity_state enable row level security;   -- no policy: no browser access
revoke all on public.db_capacity_state from public, anon, authenticated, service_role;

-- p_used / p_max / p_now exist for the tests only; cron calls it without arguments.
create or replace function public.db_capacity_check(p_used integer default null, p_max integer default null, p_now timestamptz default now())
returns text
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  c_warn_pct   constant integer  := 70;   -- warning at or over this
  c_clear_pct  constant integer  := 60;   -- back to normal under this
  c_up         constant integer  := 2;    -- checks in a row to go up
  c_down       constant integer  := 3;    -- checks in a row to come back
  c_tries      constant integer  := 3;
  c_retell     constant interval := interval '60 minutes';
  c_again      constant text     := ' (sent again)';
  st       public.db_capacity_state%rowtype;
  v_now    timestamptz := coalesce(p_now, now());
  v_used   integer;
  v_max    integer;
  v_pct    integer;
  v_text   text;
  v_word   text := 'none';
begin
  select * into st from public.db_capacity_state where id for update skip locked;
  if not found then return 'busy'; end if;

  v_max := coalesce(p_max, nullif(current_setting('max_connections', true), '')::integer);
  if v_max is null or v_max <= 0 then return 'no_limit'; end if;
  v_used := coalesce(p_used, (select count(*)::integer from pg_stat_activity a where a.backend_type = 'client backend'));
  v_used := greatest(0, least(coalesce(v_used, 0), 100000));
  v_pct  := floor(v_used * 100.0 / v_max)::integer;

  -- the level, with its two lines (70 % up, 60 % down) and checks in a row
  if st.level = 'normal' then
    if v_pct >= c_warn_pct then st.streak := st.streak + 1; else st.streak := 0; end if;
    if st.streak >= c_up then
      st.level := 'warning'; st.streak := 0; st.told := false;
      st.pending := 'warning'; st.pending_try := 0;
    end if;
  else
    if v_pct < c_clear_pct then st.streak := st.streak + 1; else st.streak := 0; end if;
    if st.streak >= c_down then
      st.level := 'normal'; st.streak := 0;
      -- "ok na ulit" only when the warning was really received; a warning still waiting is dropped
      if st.told then st.pending := 'ok'; st.pending_try := 0; else st.pending := null; st.pending_try := 0; end if;
      st.told := false;
    end if;
  end if;

  -- a warning that never got through is tried again once an hour while it still holds
  if st.level = 'warning' and not st.told and st.pending is null
     and (st.last_try_at is null or v_now - st.last_try_at >= c_retell) then
    st.pending := 'warning'; st.pending_try := 0;
  end if;

  -- a warning is only sent while the reading still holds (a retry never says "sumisikip" at 11 %)
  if st.pending is not null and not (st.pending = 'warning' and v_pct < c_clear_pct) then
    if coalesce((select btrim(s.value) from public.app_settings s where s.key = 'server_alarms_enabled'), '') = 'false' then
      v_word := 'switch_off';
      st.pending := null; st.pending_try := 0; st.last_try_at := v_now;
    else
      v_text := case st.pending
        when 'warning' then E'⚠️ SellerFlowLive database\nConnections: ' || v_used || ' sa ' || v_max || ' (' || v_pct || E'%)\nWala pang problema, pero sumisikip na.'
        else E'✅ SellerFlowLive database — ok na ulit\nConnections: ' || v_used || ' sa ' || v_max || ' (' || v_pct || '%).'
      end;
      begin
        v_word := public.parcel_silence_send(v_text || case when st.pending_try > 0 then c_again else '' end, 20000);
      exception when others then
        v_word := 'error';
      end;
      if v_word !~ '^[a-z0-9_]{1,24}$' then v_word := 'error'; end if;
      st.last_try_at := v_now;
      if v_word = 'sent' then
        st.told := (st.pending = 'warning');
        st.pending := null; st.pending_try := 0;
      else
        st.pending_try := st.pending_try + 1;
        if st.pending_try >= c_tries then st.pending := null; st.pending_try := 0; end if;   -- given up
      end if;
    end if;
  end if;

  update public.db_capacity_state
     set level = st.level, streak = st.streak, told = st.told, pending = st.pending, pending_try = st.pending_try,
         last_try_at = st.last_try_at, last_used = v_used, last_max = v_max, last_result = v_word, updated_at = v_now
   where id;
  return v_word;
exception when others then
  return 'error';     -- the check never raises: a cron run that fails must not fill the log with an error text
end
$function$;

-- callable by its owner only (the cron job runs as the owner)
revoke all on function public.db_capacity_check(integer, integer, timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('db-capacity-alarm', '1-59/5 * * * *', 'select public.db_capacity_check()');

commit;
