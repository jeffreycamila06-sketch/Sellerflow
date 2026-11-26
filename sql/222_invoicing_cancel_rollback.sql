-- Rollback of sql/222 (Invoicing: Buyer cancelled + cancelled lines). NOT APPLIED by the repo.
-- A cancelled buyer that was sent before the cancel goes back to Sent (its time kept); any other cancelled
-- buyer goes back to Not sent (its row is removed). ⚠️ Every cancelled line is forgotten (the table goes):
-- those lines are in the invoice again. No order row is touched. Then both functions get sql/220's text back.
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'invoice_sends_stamp'
                    and md5(p.prosrc) in ('9c9174b63a3ad3a313b84dee6f98011d', 'a9e642e42589c52860aa2c6d3695361e')) then
    raise exception 'sql/222 rollback: public.invoice_sends_stamp was changed after sql/222 — roll that file back first; nothing was changed';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'privacy_retention_purge'
                    and md5(p.prosrc) in ('365b824b8f2c47814f50d3b285d0955a', 'be07f0fefb29068fe43482ed5babd71b')) then
    raise exception 'sql/222 rollback: public.privacy_retention_purge was changed after sql/222 — roll that file back first; nothing was changed';
  end if;
end $guard$;

-- the clean-up first (it must not name a table that is about to go)
create or replace function public.privacy_retention_purge(p_batch integer default 5000)
returns jsonb language plpgsql set search_path = public as $$
declare
  n integer;
  v_orders integer := 0;
  v_scans integer := 0;
  v_tracking integer := 0;
  v_invoices integer := 0;   -- sql/220
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

  -- sql/220: Invoicing send status, 3 months after its last change
  loop
    delete from public.invoice_sends
     where ctid in (select ctid from public.invoice_sends
                     where updated_at < now() - interval '3 months'
                     limit p_batch);
    get diagnostics n = row_count;
    v_invoices := v_invoices + n;
    exit when n < p_batch;
  end loop;

  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking, 'invoice_sends', v_invoices);
end;
$$;
revoke all on function public.privacy_retention_purge(integer) from public, anon, authenticated;

-- cancelled buyers: back to Sent (time kept by sql/222's rule, still in place here) or Not sent
update public.invoice_sends set status = 'sent' where status = 'cancelled' and sent_at is not null;
delete from public.invoice_sends where status = 'cancelled';

create or replace function public.invoice_sends_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.sent_at := case when new.status = 'sent' then now() else null end;
  return new;
end;
$$;

alter table public.invoice_sends drop constraint if exists invoice_sends_status;
alter table public.invoice_sends add constraint invoice_sends_status check (status in ('sent', 'skipped'));

drop table if exists public.invoice_line_cancels;
drop function if exists public.invoice_line_cancels_stamp();

commit;
