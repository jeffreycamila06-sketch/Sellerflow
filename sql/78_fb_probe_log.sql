-- 78 — FACEBOOK alt probe log. NOT APPLIED — mirror for review; the reviewer applies it.
-- Read-only research rows written by server/fbProbe.js after a /fb/connect live check refused with
-- Facebook code 10: one row per probe step. METADATA ONLY (http, Facebook code/subcode/type, item
-- count, ids of videos/posts, live_status / created_time values, newest comment age, comments with
-- `from` count, first 160 chars of Facebook's error message). Never tokens, URLs, comment text or
-- commenter names/ids. Service role only. Additive and idempotent.

create table if not exists public.fb_probe_log (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  user_id uuid,
  page_id text,
  step text,
  http int,
  fb_code int,
  fb_subcode int,
  fb_type text,
  items int,
  detail jsonb
);

alter table public.fb_probe_log enable row level security;
revoke all on table public.fb_probe_log from anon;
revoke all on table public.fb_probe_log from authenticated;
