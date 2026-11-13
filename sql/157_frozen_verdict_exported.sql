-- sql/157 — FROZEN (冷凍) verdict for a parcel that was EXPORTED before the answer came.   NOT APPLIED.
-- Needs sql/142 (live). Rollback: sql/157_frozen_verdict_exported_rollback.sql (= sql/142's function).
--
-- WHY (real cases, Nov 13 2026): two 冷凍 parcels were exported ~20 s after they were saved, before
-- the live frozen check answered. Store 217237 answered no_frozen 8 s AFTER the export. The checker
-- DID send that answer — admin_parcel_frozen_verdict wrote the cache and the log, but its UPDATE has
-- "and status <> 'exported'", so the parcel row kept frozen_store_status NULL and the seller was
-- never told.
--
-- WHAT CHANGES — two functions (everything else is sql/142's live definition, checked against
-- pg_get_functiondef on 2026-11-13; same signatures, same grants, no drop):
-- 1. admin_parcel_frozen_verdict, ONE condition: an EXPORTED 冷凍 parcel whose frozen answer is still NULL / 'unknown' now receives its FIRST real
--   answer (ok / no_frozen). Then:
--     · an exported parcel that already has ok / no_frozen never changes (as before);
--     · 'unknown' is never written to an exported parcel (as before);
--     · a parcel that is not exported: exactly as before.
-- 2. admin_parcel_frozen_pending: also checks a 冷凍 parcel exported in the last 24 hours without its
--    answer (see its block below). admin_parcel_checks_pending (the dry checker) is NOT changed.
-- No table, column, trigger, policy or switch.
-- The Chrome extension is NOT changed (it already sends the answer).
-- No trigger fires on these two columns (checked: the parcel_scans triggers are on status, store_id,
-- temp_layer, store_full_status, phone_check_status and the phonebook's own column list).
--
-- Web without this file: the app's new "exported, store can't receive frozen" warning simply never
-- appears (the row stays NULL, as today). This file without the web: the row gets the answer, the old
-- app shows nothing new for an exported parcel. Either order is safe.
-- Apply check:
--   select position('p_status in (''ok'', ''no_frozen'')' in pg_get_functiondef('public.admin_parcel_frozen_verdict(uuid,text,text)'::regprocedure)) > 0;  -- true
--   select position('v_late' in pg_get_functiondef('public.admin_parcel_frozen_pending(integer)'::regprocedure)) > 0;                                 -- true
set lock_timeout = '2s';
begin;

create or replace function public.admin_parcel_frozen_verdict(p_id uuid, p_expected_store text default null, p_status text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_store text; v_layer text; v_key text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status is null or p_status not in ('ok','no_frozen','unknown') then raise exception 'bad_status'; end if;

  select ps.store_id, ps.temp_layer into v_store, v_layer from parcel_scans ps where ps.id = p_id for update;
  if not found then return; end if;
  if v_layer is distinct from '冷凍' then return; end if;  -- switched to 常溫 meanwhile: no frozen verdict
  if p_expected_store is not null and v_store is distinct from p_expected_store then return; end if;

  update parcel_scans set
    -- 'unknown' (no answer) never overwrites a real no_frozen (a blocked store stays blocked)
    frozen_store_status     = case when p_status = 'unknown' and frozen_store_status = 'no_frozen' then frozen_store_status else p_status end,
    frozen_store_checked_at = now()
  where id = p_id
    and ( status <> 'exported'
          -- sql/157: an EXPORTED parcel that never got a real answer receives its FIRST real one
          -- (ok / no_frozen) — so the seller can be warned. An exported parcel that already has a
          -- real answer never changes, and 'unknown' is never written to an exported parcel.
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
end $$;
revoke all on function public.admin_parcel_frozen_verdict(uuid, text, text) from public, anon;
grant execute on function public.admin_parcel_frozen_verdict(uuid, text, text) to authenticated;

-- ── 2. admin_parcel_frozen_pending — also hands out a parcel exported WITHOUT its frozen answer ──
-- (the seller tapped "Export anyway" before the checker picked it up). Everything else is the LIVE
-- definition (pg_get_functiondef, 2026-11-13 = sql/142's text). Added, for a 冷凍 parcel that IS
-- exported, has no real answer (NULL / 'unknown') and was exported in the last 24 hours:
--   · the cache step also gives it a FRESH cached answer (ok / no_frozen) — the same freshness as for
--     a parcel not exported (no_frozen 30 days, ok 7 days). Without this, a store answered through
--     another parcel would never reach this one (it has a fresh cache, so it is never handed out);
--   · otherwise (no fresh cache) it is handed out for a live check — the answer then reaches it
--     through change 1 above. Same per-store 10-minute floor, same 'unknown' retry, same limit.
--   · ORDER: a parcel that is NOT exported always comes first (per store and in the list), so the
--     live work of sellers who are still exporting is never delayed by these late checks.
-- An exported parcel older than 24 hours, or with a real answer, is never handed out or written.
create or replace function public.admin_parcel_frozen_pending(p_limit integer default 3)
returns table(id uuid, store_id text, created_at timestamptz, queue_depth bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_enabled text;
  v_no_ttl   constant interval := interval '30 days';
  v_ok_ttl   constant interval := interval '7 days';
  v_floor    constant interval := interval '10 minutes';
  v_retry    constant interval := interval '10 minutes';
  v_late     constant interval := interval '24 hours';   -- sql/157: exported parcels this recent are still checked
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
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
               and ( ps.frozen_store_status is null
                  or (ps.frozen_store_status = 'unknown' and ps.frozen_store_checked_at < now() - v_retry) ) ) )
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
end $$;
revoke all on function public.admin_parcel_frozen_pending(integer) from public, anon;
grant execute on function public.admin_parcel_frozen_pending(integer) to authenticated;

commit;

-- ── OPTIONAL, ONE TIME, run by hand only if Jeff wants it (NOT part of the migration above) ──
-- The parcels of the last 3 days that were exported before their answer and whose store is now known
-- to refuse frozen get that answer, so the app's warning shows for them too (Nov 13: 1 parcel, store
-- 217237). Older ones are left alone (Nov 13: 33 in all, one seller — long since dropped off).
--   update public.parcel_scans ps
--      set frozen_store_status = 'no_frozen', frozen_store_checked_at = c.checked_at
--     from public.store_frozen_cache c
--    where ps.temp_layer = '冷凍' and ps.status = 'exported' and ps.frozen_store_status is null
--      and ps.store_id = c.store_id and c.status = 'no_frozen'
--      and ps.exported_at > now() - interval '3 days';
