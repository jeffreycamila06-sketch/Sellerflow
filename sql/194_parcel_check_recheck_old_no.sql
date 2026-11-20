-- 194 — ONE-TIME re-check of waiting parcels that still show an old "no" (Jeff, Nov 21 2026).
-- NOT APPLIED by the repo. Run it by hand AFTER sql/193, on Jeff's go. Run it once.
-- No Render deploy, no extension change.
--
-- What it does: on parcels that are NOT exported, of sellers with the parcel check (parcel_check_access
-- enabled), it empties a "no" answer that is older than 5 minutes, so the checker asks 7-11 again live:
--   • store company / not_found   → store_full_status and store_full_at emptied. The existing trigger
--     trg_parcel_scans_recheck_cache then also drops that store's remembered answer (the Recheck path).
--   • frozen no_frozen (冷凍 only) → frozen_store_status emptied, frozen_store_checked_at kept (the same as a
--     ⟳ Recheck tap: the frozen lane asks 7-11, nothing is copied from memory).
-- Selected by rule, never by id. "Older than 5 minutes" = an old remembered answer under the sql/193 rule,
-- whether it was copied from another parcel or asked for this parcel long ago.
-- NOT touched: phone restricted (kept until its restriction date, by Jeff's rule), store "full" (sql/193
-- asks it again every 15 minutes), open / ok answers, "unknown", exported parcels, sellers without the check.
-- Nothing is deleted; the parcels stay where they are. A fresh answer from 7-11 replaces the empty one
-- within seconds (store, ~2-15 s) to minutes (frozen: the 10-minute per-store gap still applies).
--
-- 1. PREVIEW (read only) — run this first. On 2026-11-21 it said: company 2 · not_found 3 · no_frozen 1 = 6.
select
  count(*) filter (where ps.store_full_status = 'company'   and ps.store_full_at < now() - interval '5 minutes') as store_company,
  count(*) filter (where ps.store_full_status = 'not_found' and ps.store_full_at < now() - interval '5 minutes') as store_not_found,
  count(*) filter (where ps.temp_layer = '冷凍' and ps.frozen_store_status = 'no_frozen'
                     and ps.frozen_store_checked_at < now() - interval '5 minutes')                              as frozen_no_frozen
  from public.parcel_scans ps
 where ps.status <> 'exported'
   and exists (select 1 from public.parcel_check_access a where a.user_id = ps.user_id and a.enabled);

-- 2. THE RE-CHECK — empties exactly what the preview counted (the counts are printed as a NOTICE).
begin;
set local lock_timeout = '2s';
do $recheck$
declare n_store integer; n_frozen integer;
begin
  update public.parcel_scans ps
     set store_full_status = null, store_full_at = null
   where ps.status <> 'exported'
     and ps.store_full_status in ('company', 'not_found')
     and ps.store_full_at < now() - interval '5 minutes'
     and exists (select 1 from public.parcel_check_access a where a.user_id = ps.user_id and a.enabled);
  get diagnostics n_store = row_count;
  update public.parcel_scans ps
     set frozen_store_status = null
   where ps.status <> 'exported'
     and ps.temp_layer = '冷凍'
     and ps.frozen_store_status = 'no_frozen'
     and ps.frozen_store_checked_at < now() - interval '5 minutes'
     and exists (select 1 from public.parcel_check_access a where a.user_id = ps.user_id and a.enabled);
  get diagnostics n_frozen = row_count;
  raise notice 'sql/194: store answers emptied: %, frozen answers emptied: %, total: %', n_store, n_frozen, n_store + n_frozen;
end $recheck$;
commit;
