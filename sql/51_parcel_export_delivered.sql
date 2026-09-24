-- 51 — Phone Export: CLAIMED vs DELIVERED + authoritative Undo / Put back.
-- Mirror of the Supabase MCP migrations parcel_export_delivered + parcel_export_delivered_orphan_guard
-- (the second adds p_orphan_only: Put back can never undo a batch confirmed sent meanwhile).
--
-- Holes closed (hostile audit of 2a/2b):
--   a  stale Undo — latest-only is decided in the DB at tap time, not from a screen
--      loaded minutes/hours ago (undo_export_batch → 'not_latest').
--   b  orphans (app killed / reload / lost release) looked exactly like delivered
--      exports → never shipped. A claim is now export_delivered = false until the
--      device confirms the file went out; undelivered batches older than the window
--      are ORPHANS the app surfaces and can always put back (even if newer exports exist).
--   §2 Undo while another device is still sharing — an undelivered batch younger
--      than the window is refused ('in_progress').
--
-- State model (status is UNCHANGED — every existing reader, the batch cap, the Chrome
-- extension and older app versions still see 'exported' = hands off):
--   READY → claim → CLAIMED (exported, export_delivered=false)
--         → file confirmed sent → DELIVERED (exported, export_delivered=true)
--   CLAIMED older than the window = ORPHAN → Put back = release (no trace)
--   DELIVERED + latest → Undo = sql/50 tombstone (batch id + exported_at kept)
--
-- ADD COLUMN with a constant default is metadata-only (no row rewrite, no trigger):
-- the 816 pre-existing exported rows read as delivered. Own-scoped: SECURITY INVOKER
-- + explicit auth.uid() filters; existing own-row RLS unchanged. No Render.

alter table public.parcel_scans
  add column if not exists export_delivered boolean not null default true;

-- sql/50 body + one line: a fresh claim is NOT yet delivered.
create or replace function public.parcel_scans_stamp_exported_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'exported' and old.status is distinct from 'exported' then
    new.exported_at := now();
    new.export_delivered := false;
  elsif new.status is distinct from 'exported' and new.export_batch_id is null then
    new.exported_at := null;
  end if;
  return new;
end $$;

-- The ONLY way Undo / Put back reverts rows. p_orphan_only = the Put back button: it
-- may ONLY release a still-undelivered batch — if another device confirmed it sent in the
-- meantime it returns 'delivered' instead of undoing a file that already went out.
-- Returns:
--   'undone'      delivered latest batch → back to ready (tombstone kept, latest-only)
--   'released'    orphan (claimed, never confirmed sent, older than the window) → ready, no trace
--   'not_latest'  delivered batch that is no longer the newest export → refused
--   'in_progress' claimed within the window → another device may still be sharing → refused
--   'delivered'   (p_orphan_only) the batch was confirmed sent meanwhile → refused
--   'nothing'     no exported rows left in that batch (already undone/released)
drop function if exists public.undo_export_batch(uuid);
create or replace function public.undo_export_batch(p_batch uuid, p_orphan_only boolean default false)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_window constant interval := interval '15 minutes';  -- ⚙ the ONE tunable: in-progress vs orphan
  me uuid := auth.uid();
  v_undelivered boolean;
  v_claimed_at timestamptz;
  v_latest uuid;
  v_latest_status text;
  v_n int;
begin
  if me is null or p_batch is null then return 'nothing'; end if;

  select bool_or(not export_delivered), max(exported_at)
    into v_undelivered, v_claimed_at
    from parcel_scans
   where user_id = me and export_batch_id = p_batch and status = 'exported';
  if v_undelivered is null then return 'nothing'; end if;
  if p_orphan_only and not v_undelivered then return 'delivered'; end if;

  if v_undelivered then
    if v_claimed_at is not null and v_claimed_at > now() - c_window then return 'in_progress'; end if;
    update parcel_scans set status = 'confirmed', export_batch_id = null
     where user_id = me and export_batch_id = p_batch and status = 'exported';
    get diagnostics v_n = row_count;
    return case when v_n > 0 then 'released' else 'nothing' end;
  end if;

  select export_batch_id, status into v_latest, v_latest_status
    from parcel_scans
   where user_id = me and exported_at is not null and export_batch_id is not null
   order by exported_at desc, export_batch_id
   limit 1;
  if v_latest is distinct from p_batch or v_latest_status is distinct from 'exported' then
    return 'not_latest';
  end if;

  update parcel_scans set status = 'confirmed'
   where user_id = me and export_batch_id = p_batch and status = 'exported';
  get diagnostics v_n = row_count;
  return case when v_n > 0 then 'undone' else 'nothing' end;
end $$;

revoke execute on function public.undo_export_batch(uuid, boolean) from public, anon;
grant execute on function public.undo_export_batch(uuid, boolean) to authenticated;
