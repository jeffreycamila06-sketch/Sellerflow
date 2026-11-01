-- sql/138 — TikTok API, Branch 1 (claude/tiktok-connect): the connected TikTok Business account
-- table, the tiktok_api_enabled switch (OFF), my_feature_access() + key 'tiktok_api', and the two
-- preview rows (owner + the review test account). NOT APPLIED — chat-Claude applies.
-- Rollback: sql/138_tiktok_business_rollback.sql. Pattern: sql/126 (lock_timeout), sql/87 (RLS
-- select-own, revoke all, column-level select grant without the secret columns, FK cascade).
--
-- What it adds
--   • app_settings 'tiktok_api_enabled' = 'false' — the switch for every seller (fail-closed:
--     server AND app treat anything but the exact string 'true' as OFF).
--   • my_feature_access() = the sql/137 definition + ONE key: 'tiktok_api' (admins see it without
--     the key; a tester = one insert into feature_access_emails, feature 'tiktok_api').
--   • public.tiktok_business_accounts — one row per TikTok Business account a seller connected
--     through TikTok API for Business. access_token_enc / refresh_token_enc = AES-256-GCM
--     ciphertext written by the server only (key TIKTOK_TOKEN_KEY, never in SQL); browser roles
--     cannot read those two columns at all. No browser writes: the server (service role)
--     inserts, refreshes, revokes and deletes; disconnect revokes at TikTok first.
--   • Two preview rows: the owner and test@gmail.com (TikTok app review).
-- Nothing here touches live paths, Facebook tables or Post Sales.
begin;
set local lock_timeout = '5s';

insert into public.app_settings (key, value) values ('tiktok_api_enabled', 'false')
  on conflict (key) do nothing;

-- ── the account table ─────────────────────────────────────────────────────────
create table if not exists public.tiktok_business_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  tt_account_id      text not null,            -- TikTok's open_id for this app (no FB-style length limit)
  username           text,
  display_name       text,
  avatar_url         text,
  followers          integer,
  access_token_enc   text,                     -- server-only ciphertext
  refresh_token_enc  text,                     -- server-only ciphertext (rotated on every refresh)
  scopes             text[] not null default '{}',
  expires_at         timestamptz,              -- access token (~24 h)
  refresh_expires_at timestamptz,              -- refresh token (~1 year)
  status             text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_poll_at       timestamptz,
  last_webhook_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, tt_account_id)
);
create index if not exists tiktok_business_accounts_user on public.tiktok_business_accounts (user_id);
create index if not exists tiktok_business_accounts_status_expiry on public.tiktok_business_accounts (status, expires_at);
alter table public.tiktok_business_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tiktok_business_accounts' and policyname = 'tiktok_business_accounts_select') then
    create policy tiktok_business_accounts_select on public.tiktok_business_accounts for select using (user_id = (select auth.uid()));
  end if;
end
$$;
-- Browser roles: read own rows WITHOUT the token columns. No insert / update / delete (the
-- server's service role writes; the app disconnects through POST /tiktok/disconnect).
revoke all on table public.tiktok_business_accounts from anon;
revoke all on table public.tiktok_business_accounts from authenticated;
grant select (id, user_id, tt_account_id, username, display_name, avatar_url, followers, scopes,
  expires_at, refresh_expires_at, status, last_poll_at, last_webhook_at, created_at, updated_at)
  on public.tiktok_business_accounts to authenticated;

-- ── feature key ─────────────────────────────────────────────────────────────
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('tiktok_api')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── preview accounts (the owner + the TikTok review test account) ──────────────
insert into public.feature_access_emails (feature, email, is_prefix) values
  ('tiktok_api', 'camilajeffrey1@gmail.com', false),
  ('tiktok_api', 'test@gmail.com', false)
  on conflict (feature, email) do nothing;

commit;
