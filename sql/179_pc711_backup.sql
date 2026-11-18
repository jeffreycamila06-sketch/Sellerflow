-- 179 — 7-11 server BACKUP checker (Jeff 2026-11-18). NOT applied by the repo: apply by hand.
-- The Chrome extension on the Lenovo stays the main checker. When it stops, the Render server takes over
-- (it checks parcels and writes the answers sellers see, by the extension's rules); when the Lenovo is
-- back, the server is a follower again. The extension is NOT changed and never calls anything here.
--
-- SWITCH: app_settings pc711_backup_enabled — created 'false' here. Nothing below does anything until
-- it is exactly 'true'; every write function checks it itself (turning it off stops the server at once).
--
-- WHEN the server is on duty (decided in the database, with the database clock, from the lease the
-- extension already writes — app_settings parcel_check_worker_lease, sql/71; the server only READS it):
--   take over  = no extension machine has called the lease for 120 s, OR the leader is still calling
--                (within 120 s) and its own report says degraded (its 7-11 duty tabs are dead);
--   hand back  = the first lease call of a leader that is NOT degraded, made after the take-over;
--   a new take-over needs the full condition again. A lease that cannot be read = not on duty.
--
-- WRITES: service-role copies of the extension's functions (admin_parcel_checks_pending,
-- admin_parcel_check_verdict, admin_parcel_check_requeue, admin_parcel_frozen_pending,
-- admin_parcel_frozen_verdict, admin_set_parcel_sender_health). Same bodies; the admin gate is replaced
-- by the duty check (inside EVERY write); the two verdict copies also take p_seen_at (when the server
-- read the parcel) and never overwrite an answer written after it — the Lenovo's answer wins.
-- "unknown" is not an answer: a REAL server answer replaces an "unknown" the Lenovo wrote after the
-- read; the server's own "unknown" replaces nothing that was written after its read.
-- scripts/sql179-behaviour.mjs proves the copies equal to the live originals on a real Postgres.
--
-- pc711_backup_log: one words-only row per backup write (parcel id, kind, verdict word, result).
-- Never a phone, name or store number. No existing table, function or policy is changed.
-- CLEAN-UP: rows of pc711_backup_log older than 30 days are deleted inside pc711_backup_duty (the call
-- the server already makes), at most once a Taipei day (pc711_backup_state.log_purged_on). It touches
-- nothing but this log, never fails the duty decision, and is the one thing that also runs with the
-- switch off (old rows of an earlier duty still age out). No cron job is added or changed.
-- ROLLBACK: 179_pc711_backup_rollback.sql

begin;
set local lock_timeout = '2s';

insert into public.app_settings(key, value) values ('pc711_backup_enabled', 'false') on conflict (key) do nothing;

create table if not exists public.pc711_backup_state (
  id              smallint primary key default 1 check (id = 1),
  on_duty         boolean not null default false,
  reason          text check (reason is null or reason in ('silent', 'degraded')),
  since           timestamptz,                       -- when the current duty started
  handed_back_at  timestamptz,                       -- when the last duty ended
  alerts          jsonb not null default '[]'::jsonb, -- alert kinds not sent yet, oldest first
  log_purged_on   date,                              -- the Taipei day of the last log clean-up
  updated_at      timestamptz not null default now()
);
alter table public.pc711_backup_state add column if not exists log_purged_on date;
insert into public.pc711_backup_state(id) values (1) on conflict (id) do nothing;
alter table public.pc711_backup_state enable row level security;
revoke all on public.pc711_backup_state from public, anon, authenticated;
grant select, insert, update, delete on public.pc711_backup_state to service_role;

create table if not exists public.pc711_backup_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  scan_id  uuid,
  kind     text not null check (kind in ('store', 'phone', 'frozen', 'requeue', 'sender_health', 'duty')),
  word     text check (word is null or word ~ '^[a-z_]{1,24}$'),
  result   text not null check (result in ('written', 'kept', 'not_on_duty', 'gone'))
);
create index if not exists pc711_backup_log_at_idx on public.pc711_backup_log (at);
alter table public.pc711_backup_log enable row level security;
revoke all on public.pc711_backup_log from public, anon, authenticated;
grant select, insert, delete on public.pc711_backup_log to service_role;

-- The extension's lease, read only. readable = false when the value is not the JSON we know.
-- leader_at = the leader's last call · any_at = the last call of ANY machine (leader, standby, seen map)
-- degraded = the leader's own report (leader_state.degraded), the extension's own thresholds.
create or replace function public.pc711_backup_lease(
  out leader_at timestamptz, out any_at timestamptz, out degraded boolean, out readable boolean)
language plpgsql stable set search_path = public as $$
declare v_raw text; v jsonb; v_seen timestamptz; v_sb timestamptz;
begin
  readable := false; degraded := false; leader_at := null; any_at := null;
  select s.value into v_raw from app_settings s where s.key = 'parcel_check_worker_lease';
  if not found then readable := true; return; end if;          -- no lease row: no machine ever called
  begin
    v := v_raw::jsonb;
    if jsonb_typeof(v) is distinct from 'object' then return; end if;
    leader_at := nullif(v->>'leader_at', '')::timestamptz;
    v_sb := nullif(v->>'standby_at', '')::timestamptz;
    if jsonb_typeof(v->'seen') = 'object' then
      select max((e.value)::timestamptz) into v_seen from jsonb_each_text(v->'seen') e;
    end if;
    any_at := greatest(leader_at, v_sb, v_seen);
    degraded := coalesce(v->'leader_state'->>'degraded', 'false') = 'true';
    readable := true;
  exception when others then
    readable := false; degraded := false; leader_at := null; any_at := null;
  end;
end $$;

-- Is the server on duty RIGHT NOW? Called inside every write below. True only when the switch is
-- 'true', the state says on duty, the lease is readable, and no not-degraded leader has called since
-- the take-over (that call IS the hand-back — a write after it is refused even before the state flips).
create or replace function public.pc711_backup_on_duty()
returns boolean language plpgsql stable set search_path = public as $$
declare v_on text; st record; l record;
begin
  select s.value into v_on from app_settings s where s.key = 'pc711_backup_enabled';
  if v_on is distinct from 'true' then return false; end if;
  select * into st from pc711_backup_state where id = 1;
  if not found or not st.on_duty or st.since is null then return false; end if;
  select * into l from pc711_backup_lease();
  if not l.readable then return false; end if;
  if l.leader_at is not null and l.leader_at > st.since and not l.degraded then return false; end if;
  return true;
end $$;

-- One call per pass: decides take-over / hand-back and returns the state. Alerts are queued here, in
-- the same step as the change, so each change alerts exactly once — also across a server restart.
-- p_logged_out: the server is logged out of 7-11 at this moment (only picks the take-over text).
create or replace function public.pc711_backup_duty(p_logged_out boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_on text; st pc711_backup_state%rowtype; l record; v_now timestamptz := clock_timestamp();
  v_ttl constant interval := interval '120 seconds';
  v_keep constant interval := interval '30 days';               -- how long a backup log row is kept
  v_today date := (v_now at time zone 'Asia/Taipei')::date;
  v_change text := null; v_take text := null; v_eff boolean;
begin
  select s.value into v_on from app_settings s where s.key = 'pc711_backup_enabled';
  insert into pc711_backup_state(id) values (1) on conflict (id) do nothing;
  select * into st from pc711_backup_state where id = 1 for update;
  select * into l from pc711_backup_lease();

  -- The log clean-up: at most once a Taipei day. The day is marked FIRST, so a clean-up that fails is
  -- not tried again before tomorrow; it never fails the duty decision below.
  if st.log_purged_on is distinct from v_today then
    update pc711_backup_state set log_purged_on = v_today where id = 1;
    begin
      delete from pc711_backup_log where at < v_now - v_keep;
    exception when others then null;
    end;
  end if;

  if v_on is distinct from 'true' then
    if st.on_duty then                                           -- switched off while on duty: stop, no alert
      update pc711_backup_state set on_duty = false, handed_back_at = v_now, updated_at = v_now where id = 1;
      insert into pc711_backup_log(kind, word, result) values ('duty', 'switch_off', 'written');
      v_change := 'switch_off';
    end if;
  elsif st.on_duty then
    if l.readable and l.leader_at is not null and l.leader_at > st.since and not l.degraded then
      update pc711_backup_state set on_duty = false, handed_back_at = v_now, updated_at = v_now,
             alerts = alerts || '["handed_back"]'::jsonb where id = 1;
      insert into pc711_backup_log(kind, word, result) values ('duty', 'handed_back', 'written');
      v_change := 'handed_back';
    end if;
  elsif l.readable then
    if l.any_at is null or l.any_at <= v_now - v_ttl then v_take := 'silent';
    elsif l.leader_at is not null and l.leader_at > v_now - v_ttl and l.degraded then v_take := 'degraded';
    end if;
    if v_take is not null then
      update pc711_backup_state set on_duty = true, reason = v_take, since = v_now, updated_at = v_now,
             alerts = alerts || to_jsonb(array[case when coalesce(p_logged_out, false) then 'took_over_logged_out' else 'took_over' end])
       where id = 1;
      insert into pc711_backup_log(kind, word, result)
      values ('duty', case when v_take = 'silent' then 'took_over_silent' else 'took_over_degraded' end, 'written');
      v_change := 'took_over';
    end if;
  end if;

  select * into st from pc711_backup_state where id = 1;
  v_eff := v_on is not distinct from 'true' and st.on_duty and l.readable;
  return jsonb_build_object(
    'enabled', v_on is not distinct from 'true', 'on_duty', v_eff, 'reason', st.reason,
    'since', st.since, 'handed_back_at', st.handed_back_at, 'change', v_change, 'alerts', st.alerts,
    'lease_readable', l.readable, 'degraded', l.degraded,
    'silent_s', case when l.any_at is null then null else greatest(0, round(extract(epoch from (v_now - l.any_at))))::int end);
end $$;

-- The server sent (or gave up on) the oldest queued alert: take it off the queue.
create or replace function public.pc711_backup_alert_done(p_kind text)
returns jsonb language plpgsql set search_path = public as $$
declare st pc711_backup_state%rowtype;
begin
  select * into st from pc711_backup_state where id = 1 for update;
  if found and jsonb_array_length(st.alerts) > 0 and st.alerts->>0 = p_kind then
    update pc711_backup_state set alerts = st.alerts - 0, updated_at = now() where id = 1 returning * into st;
  end if;
  return coalesce(st.alerts, '[]'::jsonb);
end $$;

-- ── copies of the extension's write functions (service role only) ─────────────────────────────────
-- pending: the body of admin_parcel_checks_pending, word for word; its admin gate line is the duty check.
create or replace function public.pc711_backup_pending_rows(p_limit integer default 5)
returns table(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text,
              need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamptz)
language plpgsql set search_path = public as $twin$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '6 hours';
  v_store_full_ttl constant interval := interval '1 hour';
  v_store_open_ttl constant interval := interval '10 minutes';
  v_store_fixed_ttl constant interval := interval '24 hours';
  -- sql/70: the owner's shared shop pool. A row's shop moves to the next one every
  -- 20 s, so a retry never stays stuck on one dead shop.
  v_pool text[] := '{}';
  v_n integer := 0;
  v_bucket bigint := floor(extract(epoch from clock_timestamp()) / 20)::bigint;
begin
  if not public.pc711_backup_on_duty() then return; end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then return; end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  if coalesce(v_sender, '') = '' then return; end if;
  begin
    select coalesce(array_agg(t.g order by t.ord), '{}') into v_pool
      from jsonb_array_elements_text(
             (select s.value::jsonb from app_settings s where s.key = 'parcel_check_shared_gms')
           ) with ordinality as t(g, ord)
     where t.g ~ '^GM[0-9]{6,20}$';
  exception when others then
    v_pool := '{}'; -- unreadable setting → each seller's own saved link (old behaviour)
  end;
  v_n := coalesce(array_length(v_pool, 1), 0);
  update parcel_scans ps
     set phone_check_status = c.status, phone_check_message = c.message,
         phone_restricted_until = c.restricted_until, phone_check_at = now()
    from phone_check_cache c
   where ps.phone_check_status is null and ps.status <> 'exported' and ps.phone = c.phone
     and ( (c.status = 'restricted' and c.restricted_until is not null
             and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)
        or (c.status = 'ok' and c.checked_at > now() - v_ok_ttl) );
  update parcel_scans ps
     set store_full_status = c.status, store_full_at = c.checked_at
    from store_check_cache c
   where ps.status <> 'exported' and ps.store_id = c.store_id
     and ( (c.status = 'full' and c.checked_at > now() - v_store_full_ttl)
        or (c.status = 'open' and c.checked_at > now() - v_store_open_ttl)
        or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )
     and (ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at);
  return query
  with recheck as (
    select distinct on (ps.store_id) ps.id
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join store_check_cache c on c.store_id = ps.store_id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and ps.store_full_status = 'full'
       and ps.store_full_at < now() - v_store_full_ttl
       and (c.checked_at is null or c.checked_at < now() - v_store_full_ttl)
     order by ps.store_id, ps.created_at asc
  ),
  pending as (
    select ps.id, ps.phone, ps.store_id, ps.customer_name,
           case when v_n > 0
                then v_pool[1 + (((hashtext(ps.id::text)::bigint & 2147483647) + v_bucket) % v_n)::int]
                else cfg.gm_id end as gm_id,
           (ps.phone_check_status is null) as need_phone,
           (ps.store_full_status is null or r.id is not null) as need_store,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join recheck r on r.id = ps.id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and (ps.store_full_status is null or ps.phone_check_status is null or r.id is not null)
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store, (select count(*) from pending) as queue_depth, p.created_at
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $twin$;

-- read_at = when this read happened (the database clock) — sent back with each verdict as p_seen_at.
create or replace function public.pc711_backup_pending(p_limit integer default 5)
returns jsonb language plpgsql set search_path = public as $$
declare v_at timestamptz := now(); v_rows jsonb;
begin
  if not public.pc711_backup_on_duty() then return jsonb_build_object('on_duty', false, 'read_at', v_at, 'rows', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(r) - 'ord' order by r.ord), '[]'::jsonb) into v_rows
    from (select t.*, row_number() over () as ord from public.pc711_backup_pending_rows(p_limit) t) r;
  return jsonb_build_object('on_duty', true, 'read_at', v_at, 'rows', v_rows);
end $$;

-- verdict: the body of admin_parcel_check_verdict + the duty check, p_seen_at and the log rows.
-- Returns 'written' | 'not_on_duty' | 'gone'. With p_seen_at NULL it writes exactly what the original writes.
create or replace function public.pc711_backup_verdict(
  p_id uuid, p_store_full_status text default null, p_phone_check_status text default null,
  p_phone_check_message text default null, p_phone_restricted_until date default null,
  p_expected_phone text default null, p_expected_store text default null, p_seen_at timestamptz default null)
returns text language plpgsql set search_path = public as $$
declare
  v_cur_phone text; v_cur_store text;
  v_cur_store_status text; v_cur_phone_status text;
  v_apply_store boolean; v_apply_phone boolean;
  v_store_key text; v_phone_key text;
  v_store_at timestamptz; v_phone_at timestamptz;
begin
  if p_store_full_status is not null and p_store_full_status not in ('open','full','company','not_found','unknown') then
    raise exception 'bad_store_status';
  end if;
  if p_phone_check_status is not null and p_phone_check_status not in ('ok','restricted','unknown') then
    raise exception 'bad_phone_status';
  end if;
  if not public.pc711_backup_on_duty() then
    if p_store_full_status is not null then insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'store', p_store_full_status, 'not_on_duty'); end if;
    if p_phone_check_status is not null then insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'phone', p_phone_check_status, 'not_on_duty'); end if;
    return 'not_on_duty';
  end if;
  select ps.phone, ps.store_id, ps.store_full_at, ps.phone_check_at, ps.store_full_status, ps.phone_check_status
    into v_cur_phone, v_cur_store, v_store_at, v_phone_at, v_cur_store_status, v_cur_phone_status
    from parcel_scans ps where ps.id = p_id for update;
  if not found then return 'gone'; end if;
  v_apply_store := p_store_full_status is not null
                   and (p_expected_store is null or v_cur_store is not distinct from p_expected_store)
                   -- the Lenovo's answer wins: never over an answer written after the server read the parcel.
                   -- A later "unknown" is not an answer: a REAL server answer replaces it (the server's own
                   -- "unknown" does not — it replaces nothing written after the read).
                   and (p_seen_at is null or v_store_at is null or v_store_at <= p_seen_at
                        or (v_cur_store_status = 'unknown' and p_store_full_status in ('open','full','company','not_found')));
  v_apply_phone := p_phone_check_status is not null
                   and (p_expected_phone is null or v_cur_phone is not distinct from p_expected_phone)
                   and (p_seen_at is null or v_phone_at is null or v_phone_at <= p_seen_at
                        or (v_cur_phone_status = 'unknown' and p_phone_check_status in ('ok','restricted')));
  update parcel_scans set
    store_full_status      = case when not v_apply_store then store_full_status
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found') then store_full_status
                                  else p_store_full_status end,
    store_full_at          = case when not v_apply_store then store_full_at
                                  when p_store_full_status = 'unknown' and store_full_status in ('open','full','company','not_found') then store_full_at
                                  else now() end,
    phone_check_status     = case when v_apply_phone then p_phone_check_status else phone_check_status end,
    phone_check_at         = case when v_apply_phone then now() else phone_check_at end,
    phone_check_message    = case when v_apply_phone then p_phone_check_message    else phone_check_message    end,
    phone_restricted_until = case when v_apply_phone then p_phone_restricted_until else phone_restricted_until end
  where id = p_id;
  v_store_key := coalesce(p_expected_store, v_cur_store);
  v_phone_key := coalesce(p_expected_phone, v_cur_phone);
  if p_store_full_status in ('open','full','company','not_found') and coalesce(v_store_key, '') <> '' then
    insert into store_check_cache(store_id, status, checked_at) values (v_store_key, p_store_full_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
    insert into store_check_log(store_id, status, checked_at) values (v_store_key, p_store_full_status, now());
  end if;
  if p_phone_check_status in ('ok','restricted') and coalesce(v_phone_key, '') <> '' then
    insert into phone_check_cache(phone, status, message, restricted_until, checked_at)
    values (v_phone_key, p_phone_check_status, p_phone_check_message, p_phone_restricted_until, now())
    on conflict (phone) do update
      set status = excluded.status, message = excluded.message,
          restricted_until = excluded.restricted_until, checked_at = excluded.checked_at;
  end if;
  if p_store_full_status is not null then
    insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'store', p_store_full_status, case when v_apply_store then 'written' else 'kept' end);
  end if;
  if p_phone_check_status is not null then
    insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'phone', p_phone_check_status, case when v_apply_phone then 'written' else 'kept' end);
  end if;
  return 'written';
end $$;

-- requeue: the body of admin_parcel_check_requeue + the duty check (→ -1) and one log row.
create or replace function public.pc711_backup_requeue(p_since timestamptz default null)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  if not public.pc711_backup_on_duty() then
    insert into pc711_backup_log(kind, result) values ('requeue', 'not_on_duty');
    return -1;
  end if;
  update public.parcel_scans
     set store_full_status = null, store_full_at = null
   where store_full_status = 'unknown'
     and status <> 'exported'
     and created_at >= greatest(coalesce(p_since, now() - interval '6 hours'), now() - interval '6 hours');
  get diagnostics n = row_count;
  insert into pc711_backup_log(kind, result) values ('requeue', 'written');
  return n;
end $$;

-- frozen pending: the body of admin_parcel_frozen_pending (sql/178), word for word; gate → duty check.
create or replace function public.pc711_backup_frozen_pending_rows(p_limit integer default 3)
returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint)
language plpgsql set search_path = public as $twin$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '30 days';
  v_ok_ttl   constant interval := interval '1 hour';
  v_floor    constant interval := interval '10 minutes';
  v_retry    constant interval := interval '10 minutes';
  v_late     constant interval := interval '24 hours';   -- sql/157: exported parcels this recent are still checked
begin
  if not public.pc711_backup_on_duty() then return; end if;
  select s.value into v_enabled from app_settings s where s.key = 'frozen_store_check_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;

  with hit as (
    update parcel_scans ps
       set frozen_store_status = c.status, frozen_store_checked_at = now()
      from store_frozen_cache c
     where ps.temp_layer = '冷凍' and ps.store_id = c.store_id
       and ( ( ps.status <> 'exported'
               and ( (ps.frozen_store_status is null and ps.frozen_store_checked_at is null)
                  or ps.frozen_store_status = 'unknown' ) )
          -- sql/157: an exported parcel without a real answer, exported in the last 24 hours
          or ( ps.status = 'exported' and ps.exported_at > now() - v_late
               and (ps.frozen_store_status is null or ps.frozen_store_status = 'unknown') ) )
       and ( (c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)
          or (c.status = 'ok'        and c.checked_at > now() - v_ok_ttl) )
     returning c.store_id as s, c.status as st
  )
  insert into store_frozen_check_log (store_id, status, source)
  select h.s, h.st, 'cache' from hit h;

  return query
  with cand as (
    select ps.id, ps.store_id, ps.created_at, (ps.status = 'exported') as ex
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join store_frozen_cache c on c.store_id = ps.store_id
     where ps.temp_layer = '冷凍'
       and ps.store_id ~ '^[0-9]{6}$'
       and (c.checked_at is null or c.checked_at < now() - v_floor)
       and ( ( ps.status <> 'exported'
               and ( ps.frozen_store_status is null
                  or (ps.frozen_store_status = 'unknown'   and ps.frozen_store_checked_at < now() - v_retry)
                  or (ps.frozen_store_status = 'no_frozen' and ps.frozen_store_checked_at < now() - v_no_ttl) ) )
          -- sql/157: an exported parcel without a real answer (exported in the last 24 hours)
          or ( ps.status = 'exported' and ps.exported_at > now() - v_late
               and (ps.frozen_store_status is null or ps.frozen_store_status = 'unknown')
               and (ps.frozen_store_checked_at is null or ps.frozen_store_checked_at < now() - v_retry) ) )
  ),
  one as (
    select distinct on (cd.store_id) cd.id, cd.store_id, cd.created_at, cd.ex
      from cand cd
     order by cd.store_id, cd.ex asc, cd.created_at asc     -- per store: a not-exported parcel first
  )
  select o.id, o.store_id, o.created_at, (select count(*) from cand) as queue_depth
    from one o
   order by o.ex asc, o.created_at asc                       -- not-exported parcels first, then the late ones
   limit least(greatest(coalesce(p_limit, 3), 1), 25);
end $twin$;

create or replace function public.pc711_backup_frozen_pending(p_limit integer default 3)
returns jsonb language plpgsql set search_path = public as $$
declare v_at timestamptz := now(); v_rows jsonb;
begin
  if not public.pc711_backup_on_duty() then return jsonb_build_object('on_duty', false, 'read_at', v_at, 'rows', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(r) - 'ord' order by r.ord), '[]'::jsonb) into v_rows
    from (select t.*, row_number() over () as ord from public.pc711_backup_frozen_pending_rows(p_limit) t) r;
  return jsonb_build_object('on_duty', true, 'read_at', v_at, 'rows', v_rows);
end $$;

-- frozen verdict: the body of admin_parcel_frozen_verdict (sql/157) + the duty check, p_seen_at, the log row.
create or replace function public.pc711_backup_frozen_verdict(
  p_id uuid, p_expected_store text default null, p_status text default null, p_seen_at timestamptz default null)
returns text language plpgsql set search_path = public as $$
declare
  v_store text; v_layer text; v_key text; v_at timestamptz; v_cur text;
begin
  if p_status is null or p_status not in ('ok','no_frozen','unknown') then raise exception 'bad_status'; end if;
  if not public.pc711_backup_on_duty() then
    insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'frozen', p_status, 'not_on_duty');
    return 'not_on_duty';
  end if;

  select ps.store_id, ps.temp_layer, ps.frozen_store_checked_at, ps.frozen_store_status into v_store, v_layer, v_at, v_cur
    from parcel_scans ps where ps.id = p_id for update;
  if not found then return 'gone'; end if;
  if v_layer is distinct from '冷凍' then return 'gone'; end if;  -- switched to 常溫 meanwhile: no frozen verdict
  if p_expected_store is not null and v_store is distinct from p_expected_store then return 'gone'; end if;
  -- the Lenovo's answer wins: a real answer written after the server read the parcel is kept (a later
  -- "unknown" is not an answer: a real server answer replaces it); and the server's own "unknown" leaves
  -- an "unknown" written after its read as it is, check time included
  if p_seen_at is not null and v_at is not null and v_at > p_seen_at
     and (v_cur in ('ok', 'no_frozen') or (v_cur = 'unknown' and p_status = 'unknown')) then
    insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'frozen', p_status, 'kept');
    return 'written';
  end if;

  update parcel_scans set
    -- 'unknown' (no answer) never overwrites a real no_frozen (a blocked store stays blocked)
    frozen_store_status     = case when status = 'exported' and p_status = 'unknown' then frozen_store_status
                                   when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end,
    frozen_store_checked_at = now()
  where id = p_id
    and ( status <> 'exported'
          or ( p_status = 'unknown' and (frozen_store_status is null or frozen_store_status = 'unknown') )
          or ( p_status in ('ok', 'no_frozen')
               and (frozen_store_status is null or frozen_store_status = 'unknown') ) );

  v_key := coalesce(p_expected_store, v_store);
  if p_status in ('ok','no_frozen') and coalesce(v_key, '') <> '' then
    insert into store_frozen_cache (store_id, status, checked_at) values (v_key, p_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;
  end if;
  if coalesce(v_key, '') <> '' then
    insert into store_frozen_check_log (store_id, status, source) values (v_key, p_status, 'live');
  end if;
  insert into pc711_backup_log(scan_id, kind, word, result) values (p_id, 'frozen', p_status, 'written');
  return 'written';
end $$;

-- sender health: the body of admin_set_parcel_sender_health + the duty check and one log row.
create or replace function public.pc711_backup_sender_health(p_ok boolean)
returns text language plpgsql set search_path = public as $$
begin
  if not public.pc711_backup_on_duty() then
    insert into pc711_backup_log(kind, word, result) values ('sender_health', case when p_ok then 'ok' else 'restricted' end, 'not_on_duty');
    return 'not_on_duty';
  end if;
  insert into app_settings(key, value) values ('parcel_check_sender_healthy', case when p_ok then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value;
  insert into pc711_backup_log(kind, word, result) values ('sender_health', case when p_ok then 'ok' else 'restricted' end, 'written');
  return 'written';
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'pc711_backup_lease()', 'pc711_backup_on_duty()', 'pc711_backup_duty(boolean)', 'pc711_backup_alert_done(text)',
    'pc711_backup_pending_rows(integer)', 'pc711_backup_pending(integer)',
    'pc711_backup_verdict(uuid, text, text, text, date, text, text, timestamptz)', 'pc711_backup_requeue(timestamptz)',
    'pc711_backup_frozen_pending_rows(integer)', 'pc711_backup_frozen_pending(integer)',
    'pc711_backup_frozen_verdict(uuid, text, text, timestamptz)', 'pc711_backup_sender_health(boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
