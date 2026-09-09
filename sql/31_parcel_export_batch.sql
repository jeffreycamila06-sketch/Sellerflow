-- 31_parcel_export_batch.sql
-- Parcel Scan → "Undo last export" (FIX 5). Applied to prod via Supabase MCP
-- (this file is the repo mirror). ADDITIVE ONLY, nullable.
--
-- markScansExported() stamps a fresh uuid per export run into export_batch_id
-- alongside status='exported'. unmarkScansExported(batchId) reverts the whole
-- run: status back to 'confirmed' and export_batch_id back to NULL, so the rows
-- re-enter the ready list. Own-scoped by the existing sql/25 RLS policies
-- (user_id = auth.uid()) — no new policy. Pre-existing exported rows keep a NULL
-- batch id and are intentionally NOT covered by any batch undo.

alter table public.parcel_scans add column if not exists export_batch_id uuid;

create index if not exists parcel_scans_user_export_batch
  on public.parcel_scans (user_id, export_batch_id)
  where export_batch_id is not null;
