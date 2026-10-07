-- 83 rollback — removes the automatic Pickup Status check (safe when sql/83 was never applied).
-- Auto jobs are deleted first so the old kind constraint can be put back.
begin;
set local lock_timeout = '3s';
drop function if exists public.parcel_tracking_auto_check();
drop function if exists public.parcel_tracking_setting_int(text, int, int, int);
delete from public.parcel_tracking_jobs where kind = 'auto';
alter table public.parcel_tracking_jobs drop constraint if exists parcel_tracking_jobs_kind_check;
alter table public.parcel_tracking_jobs add constraint parcel_tracking_jobs_kind_check
  check (kind in ('manual','new_parcels','urgent','health'));
alter table public.parcel_tracking_access drop column if exists auto_check;
-- the claim exactly as sql/64 left it
create or replace function public.parcel_tracking_claim_job()
returns setof public.parcel_tracking_jobs language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in
    update public.parcel_tracking_jobs
       set status = 'failed', error = 'restart', finished_at = now()
     where status = 'running' and started_at < now() - interval '45 minutes'
    returning id
  loop
    perform public.parcel_tracking_refund_press(v_id);
  end loop;
  return query
  update public.parcel_tracking_jobs j
     set status = 'running', started_at = now()
   where j.id = (select q.id from public.parcel_tracking_jobs q
                  where q.status = 'queued'
                  order by q.requested_at
                  limit 1
                  for update skip locked)
  returning j.*;
end;
$$;
revoke all on function public.parcel_tracking_claim_job() from public, anon, authenticated;
grant execute on function public.parcel_tracking_claim_job() to service_role;
commit;
