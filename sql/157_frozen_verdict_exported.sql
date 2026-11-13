-- sql/157 — FROZEN (冷凍) verdict for a parcel that was EXPORTED before the answer came.   NOT APPLIED.
-- Needs sql/142 (live). Rollback: sql/157_frozen_verdict_exported_rollback.sql (= sql/142's function).
--
-- WHY (real cases, Nov 13 2026): two 冷凍 parcels were exported ~20 s after they were saved, before
-- the live frozen check answered. Store 217237 answered no_frozen 8 s AFTER the export. The checker
-- DID send that answer — admin_parcel_frozen_verdict wrote the cache and the log, but its UPDATE has
-- "and status <> 'exported'", so the parcel row kept frozen_store_status NULL and the seller was
-- never told.
--
-- WHAT CHANGES — one function, ONE condition (everything else is sql/142's live definition, checked
-- against pg_get_functiondef on 2026-11-13; same signature, same grants, no drop):
--   an EXPORTED 冷凍 parcel whose frozen answer is still NULL / 'unknown' now receives its FIRST real
--   answer (ok / no_frozen). Then:
--     · an exported parcel that already has ok / no_frozen never changes (as before);
--     · 'unknown' is never written to an exported parcel (as before);
--     · a parcel that is not exported: exactly as before.
-- No table, column, trigger, policy or switch. admin_parcel_frozen_pending is NOT changed: an exported
-- parcel is still never handed out for a check — only an answer already on its way is kept.
-- The Chrome extension is NOT changed (it already sends the answer).
-- No trigger fires on these two columns (checked: the parcel_scans triggers are on status, store_id,
-- temp_layer, store_full_status, phone_check_status and the phonebook's own column list).
--
-- Web without this file: the app's new "exported, store can't receive frozen" warning simply never
-- appears (the row stays NULL, as today). This file without the web: the row gets the answer, the old
-- app shows nothing new for an exported parcel. Either order is safe.
-- Apply check:
--   select position('p_status in (''ok'', ''no_frozen'')' in pg_get_functiondef('public.admin_parcel_frozen_verdict(uuid,text,text)'::regprocedure)) > 0;  -- true
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
