-- 73 — FACEBOOK RECEIPTS, permission phase. APPLIED in production, Oct 5 2026.
-- Additive and idempotent. Nothing reads fb_receipts_enabled yet and nothing is sent.
--
-- fb_receipt_access: accounts allowed to grant pages_messaging when authorizing a Page
-- (server/fbLive.js /fb/oauth/start adds ",pages_messaging" only for them). Same pattern as
-- buyer_alert_access (sql/72): rows added by SQL only, read by the server's service role.
-- fb_pages.can_message: written by the OAuth callback from GET /me/permissions (true only
-- when pages_messaging is "granted"). Existing pages stay false until they authorize again.
-- ⚠️ ORDER: apply this BEFORE deploying the server change — the callback writes can_message.

create table if not exists public.fb_receipt_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.fb_receipt_access enable row level security;
revoke all on public.fb_receipt_access from anon, authenticated;

alter table public.fb_pages add column if not exists can_message boolean not null default false;

insert into public.app_settings (key, value)
values ('fb_receipts_enabled', 'false')
on conflict (key) do nothing;
