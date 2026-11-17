-- 176 — Pickup Status: parcels removed by the 10-day rule are deleted for good 30 days later.
-- NOT APPLIED — the reviewer applies it. Rollback: sql/176_pickup_retired_purge_rollback.sql.
--
-- The 10-day rule (server/pickupRules.js, run by the server's check): when a check's answer is still
-- 訂單已成立，尚未至門市寄件 and the parcel was synced 10+ Taipei days ago, the row is HIDDEN —
-- terminal = true, status stays 'in_transit', status_message stays the answer. Nothing else makes an
-- in_transit row terminal (finished rows are picked_up / returned; the old "never resolves" rule
-- only finishes not_found / unknown rows).
-- RETIREMENT TIME = parcel_tracking.last_polled_at: the check that hid the row wrote it, and nothing
-- writes it again (every check reads terminal = false rows only; Sync and the Chrome extension never
-- write it).
--
-- One function + one daily pg_cron job (17:25 UTC = 01:25 Taipei, among the other purge jobs):
-- delete such rows whose last_polled_at is more than 30 days old, in batches of 1,000. 全家 rows,
-- unfinished rows, picked-up / returned rows and the old not_found / unknown finished rows are never
-- touched. No table, column, grant, policy or other function changes.
begin;
set local lock_timeout = '5s';

create or replace function public.purge_retired_pickup_parcels(p_batch integer default 1000)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare
  n     integer;
  total integer := 0;
begin
  loop
    delete from public.parcel_tracking
     where id in (select t.id from public.parcel_tracking t
                   where t.terminal
                     and t.carrier = '711'
                     and t.status = 'in_transit'
                     and position('訂單已成立' in coalesce(t.status_message, '')) > 0
                     and position('尚未至門市寄件' in coalesce(t.status_message, '')) > 0
                     and t.last_polled_at < now() - interval '30 days'
                   limit greatest(1, least(coalesce(p_batch, 1000), 5000)));
    get diagnostics n = row_count;
    total := total + n;
    exit when n = 0 or n < greatest(1, least(coalesce(p_batch, 1000), 5000));
  end loop;
  return total;
end;
$function$;
revoke all on function public.purge_retired_pickup_parcels(integer) from public, anon, authenticated;

select cron.schedule('purge-retired-pickup-parcels', '25 17 * * *', $cron$
  select public.purge_retired_pickup_parcels();
$cron$);

commit;
