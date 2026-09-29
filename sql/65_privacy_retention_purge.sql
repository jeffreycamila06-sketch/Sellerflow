-- 65 — Retention that matches the Privacy Policy (Sep 29, 2026). Idempotent.
-- Run once in the Supabase SQL editor.
--
--   orders (order history)  → deleted 3 months after created_at
--   parcel_scans            → 90 days after exported_at; never-exported drafts 180 days after created_at
--   parcel_tracking         → picked_up 7 days after pickup; returned 365 days after return
--                             (the worker's end-of-job purge stays; this makes it hold for
--                              sellers who stop checking too)
-- Unchanged: live_session_orders 10 days (jobid 1); customers, parcel_customers, products,
-- seller settings kept while the account is active (removed by account deletion).
--
-- Deletes run in batches of p_batch rows (a DELETE takes row locks only, never a table
-- lock); the first run clears the ~42k-order backlog in ~9 batches. Runs as the
-- pg_cron owner (postgres) so RLS does not apply. parcel_credit_ledger.scan_id is
-- ON DELETE SET NULL — credit history is kept, only its link to the scan is cleared.
-- The orders free-tier cap counts the last 30 days only, so a 3-month purge never
-- touches it.

create or replace function public.privacy_retention_purge(p_batch integer default 5000)
returns jsonb language plpgsql set search_path = public as $$
declare
  n integer;
  v_orders integer := 0;
  v_scans integer := 0;
  v_tracking integer := 0;
begin
  loop
    delete from public.orders
     where id in (select id from public.orders
                   where created_at < now() - interval '3 months'
                   limit p_batch);
    get diagnostics n = row_count;
    v_orders := v_orders + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_scans
     where id in (select id from public.parcel_scans
                   where (exported_at is not null and exported_at < now() - interval '90 days')
                      or (exported_at is null and created_at < now() - interval '180 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_scans := v_scans + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_tracking
     where id in (select id from public.parcel_tracking
                   where (status = 'picked_up' and coalesce(picked_up_at, updated_at) < now() - interval '7 days')
                      or (status = 'returned'  and coalesce(returned_at,  updated_at) < now() - interval '365 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_tracking := v_tracking + n;
    exit when n < p_batch;
  end loop;

  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking);
end;
$$;
revoke all on function public.privacy_retention_purge(integer) from public, anon, authenticated;

-- Daily at 17:10 UTC = 01:10 Taipei (just after the 01:00 purge jobs). cron.schedule with
-- an existing name updates that job in place, so re-running this file is safe.
select cron.schedule(
  'privacy-retention-purge',
  '10 17 * * *',
  $$select public.privacy_retention_purge()$$
);
