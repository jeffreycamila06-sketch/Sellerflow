-- 50 — Phone Export 2b LATEST-ONLY undo: keep exported_at on an UNDO (tombstone).
-- Mirror of the Supabase MCP migration parcel_scans_exported_at_tombstone.
--
-- sql/49 cleared exported_at whenever a row left 'exported'. That made "Undo last
-- export" cascade: after undoing batch B, the newest stamped batch became the one
-- BEFORE it. Latest-only rule: only the single most recent export batch is ever
-- offered; once undone, nothing older is.
--
-- The app now distinguishes the two ways a row leaves 'exported':
--   • UNDO     (undoExportBatch)     → status 'confirmed', export_batch_id KEPT
--   • RELEASE  (unmarkScansExported) → status 'confirmed', export_batch_id NULL
--     (a claim whose file was never delivered — it was never an export)
-- So: clear exported_at only when the batch id is cleared too. An undone batch keeps
-- its batch id + stamp as a tombstone, stays the newest export event, and the app
-- (loadLastExportBatch) offers nothing because that newest row is not 'exported'.
-- Re-exporting a tombstoned row restamps it with a new batch (status → 'exported').
--
-- Trigger + column unchanged from sql/49; only the function body changes. No RLS
-- change, no data rewrite (existing rows: none are tombstones yet).

create or replace function public.parcel_scans_stamp_exported_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'exported' and old.status is distinct from 'exported' then
    new.exported_at := now();
  elsif new.status is distinct from 'exported' and new.export_batch_id is null then
    new.exported_at := null;
  end if;
  return new;
end $$;
