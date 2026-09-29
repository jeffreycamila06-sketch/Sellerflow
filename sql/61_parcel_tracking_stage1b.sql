-- 61 — Parcel Tracking Stage-1b (server): persistent daily request counter, retiring
-- never-resolving rows, richer run health. MIRROR of the migration applied via MCP.
-- Additive only.
--
-- 1) parcel_tracking_daily — SHOPMORE HTTP requests per Asia/Taipei day (every GET /,
--    captcha GET and query POST counts). Survives Render restarts; a new day = a new
--    row (resets at 00:00 Taipei). Service role only.
-- 2) parcel_tracking.unchanged_polls — consecutive polls with no status change. The
--    poller retires a not_found / unknown row (terminal = true, status unchanged) after
--    5 unchanged polls once the row is older than 14 days. Written by the service-role
--    poller only: sql/42 grants sellers INSERT/UPDATE on 8 named columns, not this one.
-- 3) parcel_tracking_health — per-run sellers polled, rows skipped by the per-seller
--    cap, rows retired, and HTTP requests sent.

create table if not exists public.parcel_tracking_daily (
  day        date primary key,
  requests   integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.parcel_tracking_daily enable row level security;
revoke all on public.parcel_tracking_daily from anon, authenticated;

alter table public.parcel_tracking
  add column if not exists unchanged_polls integer not null default 0;

alter table public.parcel_tracking_health
  add column if not exists sellers     integer not null default 0,
  add column if not exists skipped_cap integer not null default 0,
  add column if not exists retired     integer not null default 0,
  add column if not exists requests    integer not null default 0;
