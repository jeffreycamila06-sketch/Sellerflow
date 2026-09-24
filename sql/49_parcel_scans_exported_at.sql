-- 49 — parcel_scans.exported_at (Phone Export 2b: cross-device "Undo last export")
-- APPLIED to production via Supabase MCP (migration parcel_scans_exported_at). This file = mirror.
--
-- Why: export batch ids are random uuids and updated_at is never maintained, so no
-- device could tell which batch was the MOST RECENT one. exported_at is stamped by
-- the DATABASE clock (now()) — never a device clock — when a row becomes 'exported',
-- and cleared when it leaves 'exported' (undo / claim release). The app's Undo then
-- loads the newest batch by exported_at, from whichever device exported it.
--
-- Additive + nullable, no backfill: the pre-existing batches keep exported_at NULL and
-- are simply not offered for cross-device undo. No RLS change — the existing own-row
-- select/update policies (user_id = auth.uid()) already cover every device of the seller.

alter table public.parcel_scans add column if not exists exported_at timestamptz;

create or replace function public.parcel_scans_stamp_exported_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'exported' and old.status is distinct from 'exported' then
    new.exported_at := now();
  elsif new.status is distinct from 'exported' then
    new.exported_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_parcel_scans_exported_at on public.parcel_scans;
create trigger trg_parcel_scans_exported_at
  before update of status on public.parcel_scans
  for each row execute function public.parcel_scans_stamp_exported_at();
