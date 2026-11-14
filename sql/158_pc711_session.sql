-- ============================================================================
-- sql/158 — 7-11 checker login: the server's saved 7-11 (OPENPOINT) session (Jeff 2026-11-14).
-- ============================================================================
-- NOT APPLIED. Jeff / chat applies via Supabase MCP after review. ADD-ONLY: one new table.
-- One row (id = 1). It holds ONLY the encrypted session blob + timestamps + state fields:
--   blob             text  'v1.' + base64(iv | tag | AES-256-GCM ciphertext). Encrypted ON THE SERVER
--                          with env PC711_SESSION_KEY; the key never reaches the database. Inside: the
--                          7-11 / OPENPOINT cookies of the server's own login + the phone's last 3 digits.
--                          The password and the SMS code are NEVER stored (used once, then dropped).
--   state            text  'connected' | 'needs_login'
--   since / last_ok_at / auto_logins / last_quick_at / quick_day / quick_day_count / last_problem / updated_at
-- RLS on, NO policies, no grants to anon / authenticated: only the server (service role) reads or
-- writes it. Nothing in the app reads this table (the Admin tile asks the server).
--
-- ⚠️ ORDER: merge → set PC711_SESSION_KEY on Render → apply this file → Render deploy → Admin →
--   7-11 Login → Connect. Without this table the server keeps the session in memory only (a deploy
--   logs it out).
-- Rollback: sql/158_pc711_session_rollback.sql (drops the table = forgets the session).
-- ============================================================================
begin;
set local lock_timeout = '2s';

create table if not exists public.pc711_session (
  id               smallint primary key default 1 check (id = 1),
  blob             text,
  state            text check (state is null or state in ('connected', 'needs_login')),
  since            timestamptz,
  last_ok_at       timestamptz,
  auto_logins      integer not null default 0,
  last_quick_at    timestamptz,
  quick_day        date,
  quick_day_count  integer not null default 0,
  last_problem     text,
  updated_at       timestamptz not null default now()
);

alter table public.pc711_session enable row level security;
revoke all on table public.pc711_session from public;
revoke all on table public.pc711_session from anon;
revoke all on table public.pc711_session from authenticated;
grant all on table public.pc711_session to service_role;

commit;
