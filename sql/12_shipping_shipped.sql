-- 12_shipping_shipped.sql
-- P3b — mark-as-shipped per export batch. Apply via Supabase MCP (not from
-- code). ADDITIVE ONLY.
--
-- Design (why a TIMESTAMP + RPC, not a status change):
--   * status stays 'exported' FOREVER — the quota RPC (sql/10) counts
--     status='exported' in its 30-day window; flipping status to 'shipped'
--     would FREE quota (an exploit). shipped_at is a pure annotation with
--     ZERO quota impact.
--   * The RLS UPDATE policy deliberately blocks exported rows
--     (exported-immutability, sql/09) — so the client cannot stamp shipped_at
--     directly. This SECURITY DEFINER RPC is the single, narrow write path:
--     it can ONLY touch shipped_at/updated_at, only on the CALLER's own
--     exported rows of ONE batch. Optional/manual — nothing enforces it.

alter table public.shipping_entries
  add column if not exists shipped_at timestamptz null;

create or replace function public.mark_shipping_batch_shipped(batch uuid, is_shipped boolean default true)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  n      integer;
begin
  if caller is null then
    return json_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  update public.shipping_entries
     set shipped_at = case when is_shipped then now() else null end,
         updated_at = now()
   where user_id = caller
     and export_batch_id = batch
     and status = 'exported';
  get diagnostics n = row_count;

  if n = 0 then
    return json_build_object('ok', false, 'error', 'batch_not_found');
  end if;
  return json_build_object('ok', true, 'count', n);
end;
$$;

grant execute on function public.mark_shipping_batch_shipped(uuid, boolean) to authenticated;
