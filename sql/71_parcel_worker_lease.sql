-- 71 — Parcel Checker automatic backup worker (extension 1.15.0) — APPLIED via MCP 2026-10-03
-- (v2 after the adversarial audit: H1 yield, M3 legacy guard always, L1/L2 hardening).
-- Two machines may run the extension; only the one holding this lease does checks.
-- The other waits and takes over when the leader has been silent for 120 s, or when the
-- leader reports itself degraded while a READY standby is waiting (yield).
-- Additive: nothing calls the lease RPC until extension 1.15.0 is installed.
-- Lease lives in app_settings key 'parcel_check_worker_lease' (JSON): leader_id, leader_label,
-- leader_at, leader_since, leader_state, takeovers, prev_leader_*, standby_id, standby_label,
-- standby_at, standby_state, yield_block_id, yield_block_until, last_yield_at, yields.
-- All times are SERVER time (clock_timestamp), except the legacy guard, which reads the
-- pre-1.15 heartbeat's client 'at'.
-- p_state (the caller's compact state) is expected to carry: sfl, myship, emap, multi (boolean),
-- degraded (boolean = "my 7-11 tabs have been dead for 10+ minutes").
-- ROLLBACK: extension 1.14.9 on ONE machine AND the extension disabled on the other.

create or replace function public.admin_parcel_worker_lease(p_worker_id text, p_label text default null, p_state jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ttl constant interval := interval '120 seconds';          -- leader silent this long → standby takes over
  v_legacy_ttl constant interval := interval '150 seconds';   -- a pre-1.15 worker (no lease, no wid) counts as alive this long
  v_standby_fresh constant interval := interval '30 seconds'; -- a standby seen this recently can be yielded to
  v_yield_block constant interval := interval '90 seconds';   -- a machine that yielded cannot retake for this long
  v_now timestamptz := clock_timestamp();
  v_id text := left(btrim(coalesce(p_worker_id, '')), 80);
  v_label text := nullif(left(btrim(coalesce(p_label, '')), 60), '');
  v_state jsonb := case when p_state is not null and jsonb_typeof(p_state) = 'object'
                             and length(p_state::text) <= 4000 then p_state else null end;
  v_raw text; v jsonb; w_raw text; w jsonb; v_sb jsonb;
  v_leader_id text; v_leader_at timestamptz; v_w_at timestamptz; v_sb_at timestamptz; v_block_until timestamptz;
  v_fresh boolean; v_legacy boolean := false; v_sb_ready boolean := false;
  v_is_leader boolean; v_reason text; v_as_standby boolean := false;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if v_id = '' then raise exception 'worker_id_required'; end if;
  insert into app_settings(key, value) values ('parcel_check_worker_lease', '{}') on conflict (key) do nothing;
  select s.value into v_raw from app_settings s where s.key = 'parcel_check_worker_lease' for update;
  begin
    v := case when coalesce(v_raw, '') like '{%' then v_raw::jsonb else '{}'::jsonb end;
  exception when others then v := '{}'::jsonb;
  end;
  if jsonb_typeof(v) is distinct from 'object' then v := '{}'::jsonb; end if;
  v_leader_id := nullif(v->>'leader_id', '');
  begin v_leader_at := (v->>'leader_at')::timestamptz; exception when others then v_leader_at := null; end;
  begin v_sb_at := (v->>'standby_at')::timestamptz; exception when others then v_sb_at := null; end;
  begin v_block_until := (v->>'yield_block_until')::timestamptz; exception when others then v_block_until := null; end;
  v_fresh := v_leader_id is not null and v_leader_at is not null and v_leader_at > v_now - v_ttl;

  -- Legacy guard (ALWAYS evaluated): an extension older than 1.15 never takes the lease, but
  -- it pushes parcel_check_worker_state without a "wid". While that heartbeat is fresh it IS
  -- the worker on duty: nobody takes over and a 1.15 leader stands down (no double work).
  select s.value into w_raw from app_settings s where s.key = 'parcel_check_worker_state';
  begin
    w := case when coalesce(w_raw, '') like '{%' then w_raw::jsonb else null end;
    if w is not null and coalesce(w->>'wid', '') = '' and (w->>'at') ~ '^[0-9]{10,16}$' then
      v_w_at := to_timestamp((w->>'at')::numeric / 1000.0);
      v_legacy := v_w_at > v_now - v_legacy_ttl and v_w_at < v_now + interval '5 minutes';
    end if;
  exception when others then v_legacy := false;
  end;

  -- Is the RECORDED standby (not the caller) proven ready right now? Strict on purpose:
  -- the leader only yields to a backup whose tabs are known good this minute.
  v_sb := v->'standby_state';
  v_sb_ready := coalesce(v->>'standby_id', '') <> '' and v->>'standby_id' <> v_id
    and v_sb_at is not null and v_sb_at > v_now - v_standby_fresh
    and v_sb is not null and jsonb_typeof(v_sb) = 'object'
    and v_sb->>'sfl' = 'connected' and v_sb->>'emap' = 'ok'
    and v_sb->>'myship' in ('ok', 'stale')
    and v_sb->>'multi' = 'true'
    and coalesce(v_sb->>'degraded', 'false') <> 'true';

  if v_legacy then
    v_as_standby := true; v_reason := 'legacy_worker_active';
  elsif v_fresh and v_leader_id <> v_id then
    v_as_standby := true; v_reason := 'leader_alive';
  elsif v_fresh and v_leader_id = v_id and coalesce(v_state->>'degraded', 'false') = 'true' and v_sb_ready then
    -- YIELD: this leader's 7-11 tabs are dead and a ready standby is waiting → free the
    -- lease now and keep this machine from retaking it for 90 s.
    v := v || jsonb_build_object(
      'prev_leader_id', v_id, 'prev_leader_label', v->>'leader_label',
      'leader_id', null, 'leader_at', null,
      'yield_block_id', v_id, 'yield_block_until', v_now + v_yield_block,
      'last_yield_at', v_now,
      'yields', (case when (v->>'yields') ~ '^[0-9]{1,9}$' then (v->>'yields')::int else 0 end) + 1);
    v_is_leader := false; v_reason := 'yielded';
    -- the ready standby's record is kept as-is (it takes the lease on its next call)
  elsif not v_fresh and v->>'yield_block_id' = v_id and v_block_until is not null and v_block_until > v_now then
    v_as_standby := true; v_reason := 'yield_cooldown';
  else
    if v_leader_id is distinct from v_id then
      v := v || jsonb_build_object(
        'prev_leader_id', coalesce(v_leader_id, v->>'prev_leader_id'),
        'prev_leader_label', case when v_leader_id is null then v->>'prev_leader_label' else v->>'leader_label' end,
        'leader_since', v_now,
        'takeovers', (case when (v->>'takeovers') ~ '^[0-9]{1,9}$' then (v->>'takeovers')::int else 0 end) + 1);
      -- another machine took the lease → the yield block has done its job
      if v->>'yield_block_id' is distinct from v_id then
        v := v - 'yield_block_id' - 'yield_block_until';
      end if;
    end if;
    v := v || jsonb_build_object('leader_id', v_id, 'leader_label', v_label, 'leader_at', v_now, 'leader_state', v_state);
    if v->>'standby_id' = v_id then
      v := v - 'standby_id' - 'standby_label' - 'standby_at' - 'standby_state';
    end if;
    v_is_leader := true; v_reason := 'leader';
  end if;

  if v_as_standby then
    v := v || jsonb_build_object('standby_id', v_id, 'standby_label', v_label, 'standby_at', v_now, 'standby_state', v_state);
    v_is_leader := false;
  end if;

  update app_settings set value = v::text where key = 'parcel_check_worker_lease';
  return jsonb_build_object(
    'leader', v_is_leader, 'reason', v_reason,
    'leader_id', case when v_legacy then null else v->>'leader_id' end,
    'leader_label', case when v_legacy then 'pre-1.15 worker' else v->>'leader_label' end,
    'leader_age_s', case when v_legacy then round(extract(epoch from (v_now - v_w_at)))
                         when (v->>'leader_at') is null then null
                         else round(extract(epoch from (v_now - (v->>'leader_at')::timestamptz))) end,
    'standby_ready', v_sb_ready,
    'ttl_s', 120);
end $function$;
revoke all on function public.admin_parcel_worker_lease(text, text, jsonb) from public, anon;
grant execute on function public.admin_parcel_worker_lease(text, text, jsonb) to authenticated;

-- Admin card: the same stats plus 'lease' (who is on duty, who is waiting) and 'server_now'.
CREATE OR REPLACE FUNCTION public.admin_parcel_check_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; w text; l text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select s.value into w from app_settings s where s.key = 'parcel_check_worker_state';
  select s.value into l from app_settings s where s.key = 'parcel_check_worker_lease';
  select jsonb_build_object(
    'enabled', coalesce((select s.value from app_settings s where s.key = 'parcel_check_multi_enabled'), 'false'),
    'queue_depth', (
      select count(*) from parcel_scans ps
        join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)),
    'oldest_pending_min', (
      select coalesce(floor(extract(epoch from (now() - min(ps.created_at))) / 60), 0) from parcel_scans ps
        join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)),
    'awaiting_setup', (
      select count(*) from parcel_scans ps
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)
         and not exists (
           select 1 from parcel_check_access acc
            where acc.user_id = ps.user_id and acc.enabled)),
    'cache_size', (select count(*) from phone_check_cache),
    'sender_phone', (select value from app_settings where key = 'parcel_check_sender_phone'),
    'sender_healthy', coalesce((select value from app_settings where key = 'parcel_check_sender_healthy'), 'true'),
    'worker', case when coalesce(w, '') like '{%' then w::jsonb else null end,
    'lease', case when coalesce(l, '') like '{_%' then l::jsonb else null end,
    'server_now', now(),
    'top_sellers', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select sp.email, count(*) as pending
          from parcel_scans ps
          join seller_profiles sp on sp.auth_user_id = ps.user_id
         where ps.status <> 'exported'
           and (ps.store_full_status is null or ps.phone_check_status is null)
         group by sp.email order by count(*) desc limit 5) t)
  ) into v;
  return v;
end $function$;
