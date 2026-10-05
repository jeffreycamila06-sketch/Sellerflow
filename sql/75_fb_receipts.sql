-- 75 — FACEBOOK RECEIPTS, send phase. APPLIED in production, Oct 5 2026. (Was applied BEFORE
-- the Render deploy that carries server/fbReceipt.js.) Additive and idempotent.
--
-- fb_receipts: one row per Messenger receipt attempt (a Private Reply to ONE live comment).
-- The partial unique index lets each comment carry at most ONE pending-or-sent row, so the
-- database itself guarantees one live message per comment even with parallel requests.
-- 'failed' rows do not block a retry (the server allows at most 2 failed attempts per comment).
-- Written and read by the server's service role only.
--
-- fb-receipts bucket: the receipt pictures, at unguessable 64-hex-character paths, public so
-- Facebook can fetch them. PNG only, 5 MB max. No storage policies: only the service role
-- (which bypasses them) uploads.

create table if not exists public.fb_receipts (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  page_id       text not null,
  live_video_id text,
  session_id    uuid,
  buyer_number  integer,
  handle        text,
  comment_id    text not null,
  status        text not null default 'pending' check (status in ('pending','sent','failed')),
  message_id    text,
  error_code    text,
  image_path    text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create unique index if not exists fb_receipts_one_live_per_comment
  on public.fb_receipts (comment_id) where status <> 'failed';
create index if not exists fb_receipts_user_session_buyer
  on public.fb_receipts (user_id, session_id, buyer_number);
alter table public.fb_receipts enable row level security;
revoke all on public.fb_receipts from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fb-receipts', 'fb-receipts', true, 5242880, array['image/png'])
on conflict (id) do nothing;
