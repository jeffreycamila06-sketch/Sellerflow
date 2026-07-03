-- 10_shipping_export_rpc.sql
-- 7-11 shipping export quota RPC (P2). Applied to prod via MCP (not from code).
--
-- check_and_export_shipping(entry_ids) — SERVER-SIDE + ATOMIC (one transaction):
--   1. reads the caller's plan (seller_profiles — NEVER client-writable),
--   2. counts the caller's exported rows in the 30-day SLIDING window
--      (exported_at >= now() - interval '30 days' — Jeff 2026-07-03; no counter
--      table, count rows directly so there is no drift),
--   3. rejects if the selection would exceed the remaining quota,
--   4. stamps status='exported' + export_batch_id + exported_at on the caller's
--      own ENCODED entries only.
-- Quotas: free 50 · basic 200 · pro 500 · master UNLIMITED (check skipped).
-- One count = one exported row (one parcel/bag; split bags count individually).
-- Concurrency: pg_advisory_xact_lock per user serializes two-device exports so
-- the quota can never be double-spent (lock releases at commit).
-- The client generates the .xlsm ONLY after this returns ok.

create or replace function public.check_and_export_shipping(entry_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  caller    uuid := auth.uid();
  user_plan text;
  quota     integer;  -- null = unlimited (master)
  used      integer := 0;
  n         integer;
  batch     uuid := gen_random_uuid();
  stamped   integer;
begin
  if caller is null then
    return json_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select plan into user_plan from public.seller_profiles where auth_user_id = caller;
  quota := case coalesce(user_plan, 'free')
             when 'master' then null
             when 'pro'    then 500
             when 'basic'  then 200
             else 50
           end;

  -- Only the caller's own ENCODED entries are exportable (drafts/re-exports skip).
  select count(*) into n
  from public.shipping_entries
  where id = any(entry_ids) and user_id = caller and status = 'encoded';

  if n = 0 then
    return json_build_object('ok', false, 'error', 'nothing_to_export');
  end if;

  if quota is not null then
    -- Serialize per-user so two devices can never both pass the same remaining
    -- quota (transaction-scoped advisory lock — released at commit/rollback).
    perform pg_advisory_xact_lock(hashtext('ship_export_' || caller::text));
    select count(*) into used
    from public.shipping_entries
    where user_id = caller
      and status = 'exported'
      and exported_at >= now() - interval '30 days';
    if used + n > quota then
      return json_build_object('ok', false, 'error', 'quota_exceeded',
                               'used', used, 'quota', quota, 'selected', n);
    end if;
  end if;

  update public.shipping_entries
     set status = 'exported',
         export_batch_id = batch,
         exported_at = now(),
         updated_at = now()
   where id = any(entry_ids) and user_id = caller and status = 'encoded';
  get diagnostics stamped = row_count;

  return json_build_object('ok', true, 'batch_id', batch, 'count', stamped,
                           'used', used + stamped, 'quota', quota);
end;
$$;

grant execute on function public.check_and_export_shipping(uuid[]) to authenticated;
