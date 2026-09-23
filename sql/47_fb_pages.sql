-- 47_fb_pages.sql
-- FACEBOOK LIVE — 4th comment source, PHASE 1 (F-P1: pure helpers + this schema).
-- ⚠️ DRAFT — NOT YET APPLIED. chat-Claude applies via Supabase MCP after review;
-- until then this is a spec on disk only. Nothing in the app reads it yet (P1 has no
-- routes/fetcher/UI — that is P2/P3). Modeled byte-close on sql/37_shopee_shops.sql.
--
-- One row per Facebook Page a seller has OAuth-authorized (mirror of shopee_shops,
-- Option A): FB pages live in their OWN table + own per-plan cap (fb_pages row count
-- vs maxAccountsForPlan) — SEPARATE from the tiktok/facebook username lists on
-- seller_profiles. registeredAccountCount / fitProfileAccounts / accountCap.js /
-- rollback App.tsx are therefore UNTOUCHED.
--
-- ⚠️ DEVIATION FROM shopee_shops (deliberate): (1) NO refresh_token column — a
-- long-lived Facebook Page access_token (~60 days) is renewed by exchanging the token
-- itself, there is no separate refresh_token (server/fbTokens.js margin = 7 days).
-- (2) page_id is TEXT, not bigint — Graph API returns object ids as strings and the
-- mapper handles them as strings (server/fbComment.js), so text avoids any 64-bit
-- coercion. (3) page_username is nullable — not every Page has a vanity username.
--
-- ── TOKENS ARE SERVER-WRITTEN ONLY ──────────────────────────────────────────
-- access_token is obtained by the server's OAuth callback (P2) and refreshed by the
-- server's timer. The client NEVER writes it (and FB_APP_SECRET never leaves the
-- server). RLS below therefore gives the seller SELECT + DELETE on their own rows (so
-- the UI can list "authorized pages" and let them disconnect), but NO insert/update
-- policy at all → under RLS a signed-in seller cannot create or mutate a page row. The
-- server writes with the service-role key (P2, bypasses RLS), the only writer.
--
-- ── TOKEN ENCRYPTION: app-layer AES-256-GCM (see server/fbTokens.js) ─────────
-- access_token stores the seller's FB Page token ENCRYPTED (base64 ciphertext), not
-- plaintext — encrypted in the Node server (AES-256-GCM, key = FB_TOKEN_KEY env),
-- RATHER than pgcrypto. Same trade-off as shopee_shops: the key stays OUT of every
-- SQL statement (no key in query logs / MCP calls), it is unit-testable in vitest with
-- Node crypto, and the schema stays a plain table.

create table if not exists public.fb_pages (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  page_id           text not null,
  page_name         text,
  page_username     text,   -- Page vanity username (nullable — not all Pages have one)
  access_token      text,   -- AES-256-GCM ciphertext (base64) — server-written only
  token_expires_at  timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, page_id)
);

-- Per-seller listing (UI "your authorized pages") + the cap count.
create index if not exists fb_pages_user on public.fb_pages (user_id);
-- Refresh timer scan: "active pages whose token expires soon" (server, P2).
create index if not exists fb_pages_active_expiry
  on public.fb_pages (active, token_expires_at);

alter table public.fb_pages enable row level security;

-- A seller may SELECT + DELETE their OWN pages (list + disconnect). There is
-- deliberately NO insert/update policy: tokens are written ONLY by the server
-- (service role, which bypasses RLS). Under RLS a seller has no write path.
create policy fb_pages_select on public.fb_pages
  for select using (user_id = auth.uid());
create policy fb_pages_delete on public.fb_pages
  for delete using (user_id = auth.uid());
-- INSERT / UPDATE: no policy → denied for authenticated/anon (RLS default-deny).
-- Server-side writes use the service-role key.

-- ── app_settings kill switch (mirror of shopee_enabled / parcel_manual_enabled) ──
-- 'fb_enabled' gates the whole Facebook UI/path. FAIL-CLOSED: the client read treats
-- missing/invalid/error as OFF — only the literal "true" opens it. Seeded 'false';
-- stays off until Jeff flips it (admin-only write via the existing app_settings RLS in
-- sql/32). The server ALSO fail-closes on env (fbConfig() needs FB_ENABLED=true +
-- app id/secret/token key all present), so both the env layer AND this row must be on
-- for Facebook to do anything.
insert into public.app_settings (key, value) values ('fb_enabled', 'false')
  on conflict (key) do nothing;
