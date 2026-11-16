-- ============================================================================
-- sql/172 — 7-11 shadow checker: full evidence, re-checks, re-asks and mirror mode (Jeff 2026-11-17).
-- ============================================================================
-- NOT APPLIED. Needs sql/159 + sql/162. ADD-ONLY: one new table, two new indexes (one on the new table's
-- sibling pc711_shadow), five new functions, one switch row (off), one pg_cron job. Nothing existing is
-- changed: parcel_scans, the caches, the regular checker's functions, pc711_shadow's rows and
-- pc711_shadow_pending stay exactly as they are. The shadow never writes parcel_scans.
--
-- pc711_shadow_evidence — ONE row per server check (first check, re-check after a changed phone /
-- store, mirror check). ADMIN ONLY: RLS on, NO policies, revoked from public / anon / authenticated —
-- only the server (service_role) reads it, and Admin sees it through the server's admin-only routes.
-- It holds the FULL phone number checked (phone rows only; Jeff's decision) and 7-11's message text;
-- they are never written to any log. Rows older than 7 days are deleted every day by the pg_cron job
-- below (at most 20,000 rows a run).
-- RETIRE (when the extension checker is retired), one statement — deletes every row and the table:
--   drop table if exists public.pc711_shadow_evidence cascade;
--
-- Fresh or remembered (the extension's verdict can come from phone_check_cache / store_check_cache,
-- filled by admin_parcel_checks_pending without asking 7-11; nothing records which):
--   phone  fresh       phone_check_cache.checked_at = parcel.phone_check_at (the verdict function writes
--                      both in ONE transaction with now())
--          remembered  the cache row is OLDER than parcel.phone_check_at (the cache fill stamps now())
--          unknown     no cache row / the cache was overwritten later by another check
--   store  fresh       store_full_at = phone_check_at (both halves written by the same verdict call)
--          remembered  store_full_at earlier than the parcel was created (the fill copies the cache's
--                      old time); mirror: also an answer stamped earlier than when the server read the
--                      parcel as still waiting (seen_waiting_at)
--          unknown     anything else (a store-only re-check, …)
--   frozen unknown     (not measured)
--
-- Changed value, verdict kept (the app decides "changed" from its LOADED list, ParcelScan.tsx): a new
-- phone / store with the SAME extension verdict time as the previous row → flag
-- phone_changed_verdict_kept / store_changed_verdict_kept. Mirror rows that stop waiting because the parcel
-- was deleted or its value changed before the extension answered: parcel_gone / value_changed_before_answer.
-- Rollback: sql/172_pc711_shadow_evidence_rollback.sql
-- Proof:    scripts/sql172-behaviour.mjs (PGlite)
-- ============================================================================
begin;
set local lock_timeout = '2s';

create table if not exists public.pc711_shadow_evidence (
  id                   bigserial primary key,
  at                   timestamptz not null default now(),          -- when the row was written
  scan_id              uuid not null,                                -- parcel_scans.id (no foreign key)
  seller_id            uuid,                                         -- parcel_scans.user_id
  kind                 text not null check (kind in ('store', 'phone', 'frozen')),
  round                integer not null default 1 check (round >= 1), -- 1 = first check, 2+ = re-check (changed value)
  mode                 text not null default 'after' check (mode in ('after', 'mirror')),
  input                text not null default '',                     -- the value checked: phone (phone rows) or store number
  store_id             text,
  phone                text,                                         -- FULL phone, phone rows only (never logged)
  flag                 text check (flag is null or flag in ('phone_changed_verdict_kept', 'store_changed_verdict_kept',
                                                       'value_changed_before_answer', 'parcel_gone')),
  queue_waiting        integer check (queue_waiting is null or queue_waiting >= 0), -- jobs waiting when this one was picked
  parcel_created_at    timestamptz,
  -- the extension
  ext_at               timestamptz,                                  -- its verdict time (phone_check_at / store_full_at / frozen_store_checked_at)
  ext_verdict          text,
  ext_message          text check (ext_message is null or length(ext_message) <= 120),
  ext_restricted_until date,
  ext_source           text check (ext_source is null or ext_source in ('fresh', 'remembered', 'unknown')),
  ext_cache_at         timestamptz,                                  -- the cache time behind the verdict (phone)
  ext_age_s            integer,                                      -- store: how old the extension's answer was when the server asked
  ext_late             boolean not null default false,               -- mirror: the extension answered after the 15-minute limit
  ext_timeout          boolean not null default false,               -- mirror: no extension answer within 15 minutes
  pair_closed          boolean not null default false,               -- mirror: stopped waiting (answered, or 6 h passed)
  seen_waiting_at      timestamptz,                                  -- mirror: when the server read the parcel as still waiting
  -- the server
  srv_started_at       timestamptz,
  srv_finished_at      timestamptz,
  srv_verdict          text,
  srv_raw              text check (srv_raw is null or srv_raw in ('enable', 'disable', 'close', 'NO2', 'other', 'Status:true', 'Status:false-restricted', 'Status:false-other')),
  srv_http             integer,
  srv_ms               integer,
  bad_input_rule       text check (bad_input_rule is null or bad_input_rule ~ '^[a-z0-9_]{1,32}$'),
  match                boolean,                                      -- NULL = no pair yet / a server error / extension unknown
  first                text check (first is null or first in ('server', 'extension')), -- mirror: who finished first
  first_by_ms          integer,
  -- re-asks (a real phone mismatch only): ~30 s and ~5 min after the check
  reask_next_at        timestamptz,
  reask_n              smallint not null default 0 check (reask_n between 0 and 2),
  reask1_at            timestamptz,
  reask1_word          text check (reask1_word is null or reask1_word ~ '^[a-z0-9_]{1,32}$'),
  reask2_at            timestamptz,
  reask2_word          text check (reask2_word is null or reask2_word ~ '^[a-z0-9_]{1,32}$'),
  -- a server error
  fail_step            text check (fail_step is null or fail_step ~ '^[a-z.]{1,24}$'),
  fail_http            integer,
  fail_reason          text check (fail_reason is null or fail_reason ~ '^[a-z0-9_]{0,32}$'),
  fail_at              timestamptz,
  steps                jsonb not null default '[]'::jsonb
);
-- one row per (parcel, kind, value checked): a changed phone / store is a new row
create unique index if not exists pc711_evidence_scan_kind_input_key on public.pc711_shadow_evidence (scan_id, kind, input);
create index if not exists pc711_evidence_at_idx on public.pc711_shadow_evidence (at desc);
create index if not exists pc711_evidence_reask_idx on public.pc711_shadow_evidence (reask_next_at) where reask_next_at is not null;
create index if not exists pc711_evidence_awaiting_idx on public.pc711_shadow_evidence (id) where mode = 'mirror' and ext_at is null and not pair_closed;
-- the "restricted" line reads pc711_shadow's restricted phone rows only
create index if not exists pc711_shadow_restricted_idx on public.pc711_shadow (at) where kind = 'phone' and ext_verdict = 'restricted';

alter table public.pc711_shadow_evidence enable row level security;
revoke all on table public.pc711_shadow_evidence from public;
revoke all on table public.pc711_shadow_evidence from anon;
revoke all on table public.pc711_shadow_evidence from authenticated;
grant all on table public.pc711_shadow_evidence to service_role;
revoke all on sequence public.pc711_shadow_evidence_id_seq from public, anon, authenticated;
grant usage, select on sequence public.pc711_shadow_evidence_id_seq to service_role;

-- ── after-mode queue: the parcels the extension checked since p_since whose CURRENT value has no
-- evidence row yet (a changed phone / store = a new job). A parcel already compared in pc711_shadow
-- BEFORE this file (pc711_shadow row, no evidence row) is not checked again — its old value is not
-- known, so a later change can't be told from a re-stamp; this only matters for the 6 h after the
-- apply (the look-back). Oldest first; ≤ 50.
create or replace function public.pc711_evidence_pending(p_since timestamptz, p_limit integer)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with j as (
    select s.id as scan_id, 'store'::text as kind, s.store_full_status as ext, s.store_full_at as at,
           s.store_id, null::text as phone, null::text as customer_name, coalesce(s.store_id, '') as input,
           s.user_id as seller_id, s.created_at, null::text as msg, null::date as until,
           null::timestamptz as cache_at,
           case when s.store_full_at = s.phone_check_at then 'fresh'
                when s.store_full_at < s.created_at then 'remembered' else 'unknown' end as source
      from public.parcel_scans s where s.store_full_status is not null and s.store_full_at >= p_since
    union all
    select s.id, 'phone', s.phone_check_status, s.phone_check_at, s.store_id, s.phone, s.customer_name, coalesce(s.phone, ''),
           s.user_id, s.created_at, left(s.phone_check_message, 120), s.phone_restricted_until,
           c.checked_at,
           case when c.checked_at is null then 'unknown'
                when c.checked_at = s.phone_check_at then 'fresh'
                when c.checked_at < s.phone_check_at then 'remembered' else 'unknown' end
      from public.parcel_scans s left join public.phone_check_cache c on c.phone = s.phone
     where s.phone_check_status is not null and s.phone_check_at >= p_since
    union all
    select s.id, 'frozen', s.frozen_store_status, s.frozen_store_checked_at, s.store_id, null, null, coalesce(s.store_id, ''),
           s.user_id, s.created_at, null, null, null, 'unknown'
      from public.parcel_scans s where s.frozen_store_status is not null and s.frozen_store_checked_at >= p_since
  ), w as (
    select j.* from j
     where not exists (select 1 from public.pc711_shadow_evidence e where e.scan_id = j.scan_id and e.kind = j.kind and e.input = j.input)
       and (exists (select 1 from public.pc711_shadow_evidence e where e.scan_id = j.scan_id and e.kind = j.kind)
            or not exists (select 1 from public.pc711_shadow x where x.scan_id = j.scan_id and x.kind = j.kind))
  )
  select jsonb_build_object(
    'waiting', (select count(*) from w),
    'jobs', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.scan_id, t.kind)
                        from (select w.*, p.input as prev_input, p.ext_at as prev_ext_at, coalesce(p.round, 0) + 1 as round
                                from (select * from w order by at, scan_id, kind
                                       limit greatest(0, least(coalesce(p_limit, 0), 50))) w
                                left join lateral (select e.input, e.ext_at, e.round from public.pc711_shadow_evidence e
                                                    where e.scan_id = w.scan_id and e.kind = w.kind
                                                    order by e.id desc limit 1) p on true) t), '[]'::jsonb));
$$;
revoke all on function public.pc711_evidence_pending(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.pc711_evidence_pending(timestamptz, integer) to service_role;

-- ── mirror queue: parcels of the regular checker's sellers (parcel_check_access) created since p_since,
-- not exported, still WAITING for the extension's phone / store verdict, whose current value has no
-- evidence row yet. Reads the existing partial index parcel_scans_unchecked_idx. Oldest first; ≤ 50.
create or replace function public.pc711_mirror_pending(p_since timestamptz, p_limit integer)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with s as (
    select s.* from public.parcel_scans s
      join public.parcel_check_access acc on acc.user_id = s.user_id and acc.enabled
     where s.status <> 'exported' and (s.store_full_status is null or s.phone_check_status is null)
       and s.created_at >= p_since
  ), j as (
    select s.id as scan_id, 'phone'::text as kind, s.store_id, s.phone, s.customer_name, coalesce(s.phone, '') as input,
           s.user_id as seller_id, s.created_at as at, s.created_at
      from s where s.phone_check_status is null
    union all
    select s.id, 'store', s.store_id, null, null, coalesce(s.store_id, ''), s.user_id, s.created_at, s.created_at
      from s where s.store_full_status is null
  ), w as (
    select j.* from j
     where not exists (select 1 from public.pc711_shadow_evidence e where e.scan_id = j.scan_id and e.kind = j.kind and e.input = j.input)
  )
  select jsonb_build_object(
    'waiting', (select count(*) from w),
    'jobs', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.scan_id, t.kind)
                        from (select w.*, coalesce(p.round, 0) + 1 as round
                                from (select * from w order by at, scan_id, kind
                                       limit greatest(0, least(coalesce(p_limit, 0), 50))) w
                                left join lateral (select e.round from public.pc711_shadow_evidence e
                                                    where e.scan_id = w.scan_id and e.kind = w.kind
                                                    order by e.id desc limit 1) p on true) t), '[]'::jsonb));
$$;
revoke all on function public.pc711_mirror_pending(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.pc711_mirror_pending(timestamptz, integer) to service_role;

-- ── mirror rows still waiting for the extension: first marks the 15-minute limit (ext_timeout) and
-- stops waiting after 6 h (pair_closed), then returns up to p_limit (≤ 50) waiting rows with the
-- parcel's CURRENT value and verdict (gone = the parcel was deleted). Reads the partial index only.
create or replace function public.pc711_mirror_awaiting(p_limit integer)
returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
begin
  update public.pc711_shadow_evidence e set ext_timeout = true
   where e.mode = 'mirror' and e.ext_at is null and not e.pair_closed and not e.ext_timeout
     and e.srv_finished_at < now() - interval '15 minutes';
  update public.pc711_shadow_evidence e set pair_closed = true
   where e.mode = 'mirror' and e.ext_at is null and not e.pair_closed
     and e.at < now() - interval '6 hours';
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.id)
      from (select e.id, e.scan_id, e.kind, e.round, e.input, e.srv_started_at, e.srv_finished_at, e.srv_verdict, e.srv_raw,
                   e.srv_http, e.srv_ms, e.steps, e.fail_step, e.fail_http, e.fail_reason, e.ext_timeout,
                   (s.id is null) as gone,
                   case e.kind when 'phone' then coalesce(s.phone, '') else coalesce(s.store_id, '') end as cur_input,
                   case e.kind when 'phone' then s.phone_check_status else s.store_full_status end as ext,
                   case e.kind when 'phone' then s.phone_check_at else s.store_full_at end as ext_at,
                   case e.kind when 'phone' then left(s.phone_check_message, 120) end as msg,
                   case e.kind when 'phone' then s.phone_restricted_until end as until,
                   case e.kind when 'phone' then c.checked_at end as cache_at,
                   case when e.kind = 'phone' then
                          case when c.checked_at is null then 'unknown'
                               when c.checked_at = s.phone_check_at then 'fresh'
                               when c.checked_at < s.phone_check_at then 'remembered' else 'unknown' end
                        else
                          case when s.store_full_at = s.phone_check_at then 'fresh'
                               when s.store_full_at < s.created_at or s.store_full_at < e.seen_waiting_at then 'remembered' else 'unknown' end
                   end as source
              from (select * from public.pc711_shadow_evidence
                     where mode = 'mirror' and ext_at is null and not pair_closed
                     order by id limit greatest(0, least(coalesce(p_limit, 0), 50))) e
              left join public.parcel_scans s on s.id = e.scan_id
              left join public.phone_check_cache c on e.kind = 'phone' and c.phone = s.phone) t), '[]'::jsonb);
end;
$$;
revoke all on function public.pc711_mirror_awaiting(integer) from public, anon, authenticated;
grant execute on function public.pc711_mirror_awaiting(integer) to service_role;

-- ── Admin totals for [p_from, p_to): one small jsonb. Evidence rows by mode × kind × source (compared,
-- agree), errors, mirror first / late / timeout, store answer age, re-asks; the "restricted" line from
-- pc711_shadow's restricted phone rows (its own partial index) + evidence re-check rows.
create or replace function public.pc711_evidence_totals(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with e as (
    select * from public.pc711_shadow_evidence where at >= p_from and at < p_to
  ), g as (
    select mode, kind, coalesce(ext_source, 'unknown') as source,
           count(*) filter (where match is not null) as compared,
           count(*) filter (where match) as agree
      from e group by 1, 2, 3
  ), r as (
    select srv_verdict from public.pc711_shadow
     where kind = 'phone' and ext_verdict = 'restricted' and at >= p_from and at < p_to and match is not null
    union all
    select srv_verdict from e where kind = 'phone' and ext_verdict = 'restricted' and round > 1 and match is not null
  )
  select jsonb_build_object(
    'rows', (select count(*) from e),
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'kind', kind, 'source', source, 'compared', compared, 'agree', agree)
                                         order by mode, kind, source) from g), '[]'::jsonb),
    'errors', jsonb_build_object('after', (select count(*) from e where mode = 'after' and fail_reason is not null),
                                 'mirror', (select count(*) from e where mode = 'mirror' and fail_reason is not null)),
    'rechecks', (select count(*) from e where round > 1),
    'flags', (select count(*) from e where flag is not null),
    'mirror', jsonb_build_object(
       'n', (select count(*) from e where mode = 'mirror'),
       'serverFirst', (select count(*) from e where mode = 'mirror' and first = 'server'),
       'extensionFirst', (select count(*) from e where mode = 'mirror' and first = 'extension'),
       'avgFirstByMs', (select round(avg(first_by_ms)) from e where mode = 'mirror' and first_by_ms is not null),
       'late', (select count(*) from e where ext_late),
       'timeout', (select count(*) from e where ext_timeout and ext_at is null)),
    'storeAge', jsonb_build_object(
       'n', (select count(*) from e where kind = 'store' and ext_age_s is not null),
       'avgS', (select round(avg(ext_age_s)) from e where kind = 'store' and ext_age_s is not null),
       'maxS', (select max(ext_age_s) from e where kind = 'store' and ext_age_s is not null)),
    'reasked', (select count(*) from e where reask_n > 0),
    'restricted', jsonb_build_object('agree', (select count(*) from r where srv_verdict = 'restricted'),
                                     'disagree', (select count(*) from r where srv_verdict is distinct from 'restricted')));
$$;
revoke all on function public.pc711_evidence_totals(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pc711_evidence_totals(timestamptz, timestamptz) to service_role;

-- ── 7-day deletion: at most 20,000 of the oldest rows a run (the index on at), daily 01:30 Taipei.
create or replace function public.pc711_evidence_purge()
returns integer language sql volatile set search_path = public, pg_temp as $$
  with d as (
    delete from public.pc711_shadow_evidence
     where id in (select id from public.pc711_shadow_evidence
                   where at < now() - interval '7 days' order by at limit 20000)
    returning 1)
  select count(*)::integer from d;
$$;
revoke all on function public.pc711_evidence_purge() from public, anon, authenticated;
grant execute on function public.pc711_evidence_purge() to service_role;

-- the mirror switch (off)
insert into public.app_settings (key, value) values ('pc711_mirror_enabled', 'false')
  on conflict (key) do nothing;

commit;

-- pg_cron (outside the transaction, like sql/65): 17:30 UTC = 01:30 Taipei
select cron.schedule('purge-pc711-shadow-evidence', '30 17 * * *', $c$select public.pc711_evidence_purge()$c$);
