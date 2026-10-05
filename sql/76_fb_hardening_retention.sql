-- 76 — FACEBOOK hardening + receipt retention. Applied by hand (see CLAUDE.md).
-- (a) fb_pages: browser roles can no longer read the access_token column.
revoke all on table public.fb_pages from anon;
revoke all on table public.fb_pages from authenticated;
grant select (id, user_id, page_id, page_name, page_username, token_expires_at, active,
  can_message, created_at, updated_at) on public.fb_pages to authenticated;
grant delete on public.fb_pages to authenticated;
-- (b) fb_receipts: rows older than 90 days are deleted daily (01:20 Asia/Taipei).
select cron.schedule('purge-old-fb-receipts', '20 17 * * *',
  $$delete from public.fb_receipts where created_at < now() - interval '90 days'$$);
