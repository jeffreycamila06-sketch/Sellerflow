-- ============================================================================
-- sql/111 — fb_pages.fb_user_id: the Facebook user (app-scoped id) who authorized the Page.
-- ============================================================================
-- NOT APPLIED. Additive, nullable, no backfill (Pages saved before this have NULL). The server
-- writes it after each authorization and Meta's Deauthorize Callback (POST /fb/deauthorize)
-- deletes the Pages that carry the removed person's id. Browser roles get no access to it (the
-- sql/76 column grants list stays as it is). Before this file the server keeps working: the
-- write fails quietly and the callback finds nothing. Rollback: sql/111_fb_pages_fb_user_id_rollback.sql.
-- ============================================================================
alter table public.fb_pages add column if not exists fb_user_id text;
create index if not exists fb_pages_fb_user_id on public.fb_pages (fb_user_id) where fb_user_id is not null;
