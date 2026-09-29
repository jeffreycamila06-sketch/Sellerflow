-- 64 — Parcel Tracking Stage 2 follow-up: give the daily press back when a seller's
-- manual check did nothing. Idempotent. Run once in the Supabase SQL editor.
--
-- The worker calls parcel_tracking_refund_press(job) when a manual job finishes with
-- 0 parcels in scope, or ends 'failed' (worker error). parcel_tracking_claim_job() now
-- also refunds when it fails a stale 'running' job (Render restart), so a crash never
-- eats a press. Only kind='manual' AND created_by='seller' jobs ever touched the press
-- (sql/63 request_check), so only those are refunded — the function checks both itself.

create or replace function public.parcel_tracking_refund_press(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select j.user_id into v_user from public.parcel_tracking_jobs j
   where j.id = p_job_id and j.kind = 'manual' and j.created_by = 'seller';
  if v_user is null then return false; end if;
  update public.parcel_tracking_access
     set last_manual_check_at = null, last_manual_check_day = null
   where user_id = v_user;
  return found;
end;
$$;
revoke all on function public.parcel_tracking_refund_press(uuid) from public, anon, authenticated;
grant execute on function public.parcel_tracking_refund_press(uuid) to service_role;

-- sql/63's claim, plus the refund for each stale job it fails.
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
