-- 77 — FACEBOOK testers without a code change. NOT APPLIED — mirror for review; apply by hand.
-- A row (email in lower case, enabled = true) opens the Facebook feature for that seller, on top of
-- app_settings.fb_enabled and the hard-coded FB_PREVIEW_EMAILS. Read ONLY by the server with the
-- service role (server/fbAccess.js createFbTesterReader, cached 60 s). DB testers still go through
-- the normal plan checks. Messenger receipts stay gated by fb_receipt_access only.
-- Additive and idempotent.
--
-- Add a tester:     insert into public.fb_tester_access (email, note) values (lower('seller@example.com'), 'why')
--                     on conflict (email) do update set enabled = true;
-- Remove a tester:  update public.fb_tester_access set enabled = false where email = lower('seller@example.com');

create table if not exists public.fb_tester_access (
  email text primary key check (email = lower(email)),
  enabled boolean not null default true,
  note text,
  created_at timestamptz default now()
);

alter table public.fb_tester_access enable row level security;
revoke all on table public.fb_tester_access from anon;
revoke all on table public.fb_tester_access from authenticated;
