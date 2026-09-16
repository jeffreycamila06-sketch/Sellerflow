-- 37_shopee_shops.sql
-- SHOPEE LIVE — 3rd comment source, PHASE 1 (pure helpers + this schema).
-- ⚠️ DRAFT — NOT YET APPLIED. chat-Claude applies via Supabase MCP after review;
-- until then this is a spec on disk only. Nothing in the app reads it yet (P1 has
-- no routes/poller/UI — that is P2/P3).
--
-- One row per Shopee shop a seller has OAuth-authorized (Option A, Jeff's call):
-- Shopee shops live in their OWN table + own per-plan cap (shopee_shops row count
-- vs maxAccountsForPlan) — SEPARATE from the tiktok/facebook username lists on
-- seller_profiles. registeredAccountCount / fitProfileAccounts / accountCap.js /
-- rollback App.tsx are therefore UNTOUCHED.
--
-- ── TOKENS ARE SERVER-WRITTEN ONLY ──────────────────────────────────────────
-- access_token / refresh_token are obtained by the server's OAuth callback (P2)
-- and refreshed by the server's timer. The client NEVER writes them (and
-- partner_key never leaves the server). RLS below therefore gives the seller
-- SELECT + DELETE on their own rows (so the UI can list "authorized shops" and
-- let them disconnect), but NO insert/update policy at all → under RLS a signed-in
-- seller cannot create or mutate a shop row. The server writes with the
-- service-role key (P2, bypasses RLS), the only writer.
--
-- ── TOKEN ENCRYPTION: app-layer AES-256-GCM (see server/shopeeTokens.js) ─────
-- access_token / refresh_token store the seller's Shopee tokens ENCRYPTED, not
-- plaintext. Decision: encrypt in the Node server (server/shopeeTokens.js, AES-
-- 256-GCM, key = SHOPEE_TOKEN_KEY env) and store the base64 ciphertext in these
-- text columns — RATHER than pgcrypto pgp_sym_encrypt.
--   Trade-off: app-layer keeps the key OUT of every SQL statement (pgcrypto would
--   pass the key as a SQL argument on every read/write, so it shows up in query
--   logs / MCP calls), is unit-testable in vitest with Node crypto, and keeps the
--   schema a plain table. Cost: decryption is only in the Node process (fine — the
--   poller/refresher run there); no in-DB decryption. If key rotation is ever
--   needed, re-encrypt rows with a versioned key prefix (future).

create table if not exists public.shopee_shops (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  shop_id           bigint not null,
  shop_name         text,
  access_token      text,   -- AES-256-GCM ciphertext (base64) — server-written only
  refresh_token     text,   -- AES-256-GCM ciphertext (base64) — server-written only
  token_expires_at  timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, shop_id)
);

-- Per-seller listing (UI "your authorized shops") + the cap count.
create index if not exists shopee_shops_user on public.shopee_shops (user_id);
-- Refresh timer scan: "active shops whose token expires soon" (server, P2).
create index if not exists shopee_shops_active_expiry
  on public.shopee_shops (active, token_expires_at);

alter table public.shopee_shops enable row level security;

-- A seller may SELECT + DELETE their OWN shops (list + disconnect). There is
-- deliberately NO insert/update policy: tokens are written ONLY by the server
-- (service role, which bypasses RLS). Under RLS a seller has no write path.
create policy shopee_shops_select on public.shopee_shops
  for select using (user_id = auth.uid());
create policy shopee_shops_delete on public.shopee_shops
  for delete using (user_id = auth.uid());
-- INSERT / UPDATE: no policy → denied for authenticated/anon (RLS default-deny).
-- Server-side writes use the service-role key.

-- ── app_settings kill switch (mirror of parcel_manual_enabled) ──────────────
-- 'shopee_enabled' gates the whole Shopee UI/path. FAIL-CLOSED: the client read
-- treats missing/invalid/error as OFF — only the literal "true" opens it. Seeded
-- 'false'; stays off until Jeff flips it (admin-only write via the existing
-- app_settings RLS in sql/32). The server ALSO fail-closes on env (shopeeConfig()
-- needs SHOPEE_ENABLED=true + partner id/key/token key all present), so both the
-- env layer AND this row must be on for Shopee to do anything.
insert into public.app_settings (key, value) values ('shopee_enabled', 'false')
  on conflict (key) do nothing;
