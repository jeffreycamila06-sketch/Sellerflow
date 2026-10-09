-- Build 10b — feature allowlists move out of the app bundle into the database.
-- The app used to carry seller/test emails in its JavaScript (preview and dogfood lists).
-- Now one read RPC answers ONLY booleans for the signed-in user; the list itself is not
-- readable by any browser role. NOT APPLIED — apply by hand (Supabase SQL editor / MCP).
-- Rollback: sql/112_feature_access_rollback.sql.
--
-- Email = the LOGIN email (auth.users.email), never seller_profiles.email (user-editable).
-- Match: exact (lower/trim), or a prefix when is_prefix (pin_print 'budgetukay').
-- Admin bypass stays in the app (role check), exactly as before.
-- ⚠️ test@gmail.com in fb_preview is PERMANENT — Meta App Review's login.

create table public.feature_access_emails (
  feature    text not null,
  email      text not null check (email = lower(btrim(email)) and email <> ''),
  is_prefix  boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (feature, email)
);
alter table public.feature_access_emails enable row level security;
-- No policies on purpose: anon/authenticated cannot read or write the list.
revoke all on public.feature_access_emails from anon, authenticated;

create function public.my_feature_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$$;
revoke all on function public.my_feature_access() from public, anon;
grant execute on function public.my_feature_access() to authenticated;

insert into public.feature_access_emails (feature, email, is_prefix) values
  ('fb_preview', 'camilajeffrey1@gmail.com', false),
  ('fb_preview', 'googletest@gmail.com', false),
  ('fb_preview', 'test@gmail.com', false),
  ('kiosk_launcher', 'googletest@gmail.com', false),
  ('parcel_check', 'googletest@gmail.com', false),
  ('parcel_check', 'googletest@sellerflowlive.com', false),
  ('parcel_check', 'ukaydaily1@gmail.com', false),
  ('parcel_check', 'sanggalanglhea@gmail.com', false),
  ('parcel_check', 'h0kmming@yahoo.com.tw', false),
  ('parcel_check', 'details2ndserve@gmail.com', false),
  ('parcel_check', 'chungmaychilleann@gmail.com', false),
  ('parcel_check', 'choletrada1022@gmail.com', false),
  ('parcel_check', 'bertongpatag@gmail.com', false),
  ('parcel_check', 'jaszhu127@gmail.com', false),
  ('parcel_check', 'ganggang0958@yahoo.com', false),
  ('parcel_check', 'jinkyrosepenana@gmail.com', false),
  ('parcel_check', 'karenbaltazar040789@gmail.com', false),
  ('parcel_check', 'basaomenchie6@gmail.com', false),
  ('parcel_check', 'lailinehsu@gmail.com', false),
  ('parcel_cap_tester', 'googletest@gmail.com', false),
  ('parcel_cap_tester', 'googletest@sellerflowlive.com', false),
  ('pin_print', 'budgetukay5@gmail.com', false),
  ('pin_print', 'ronaldgantiga77@gmail.com', false),
  ('pin_print', 'tincabanas13@gmail.com', false),
  ('pin_print', 'cristycabanas34@gmail.com', false),
  ('pin_print', 'googletest@gmail.com', false),
  ('pin_print', 'googletest@sellerflowlive.com', false),
  ('sticker_v2', 'cristycabanas34@gmail.com', false),
  ('sticker_v2', 'ronaldgantiga77@gmail.com', false),
  ('sticker_v2', 'tincabanas13@gmail.com', false),
  ('sticker_v2', 'googletest@gmail.com', false),
  ('sticker_spacing', 'googletest@gmail.com', false),
  ('sticker_spacing', 'googletest@sellerflowlive.com', false),
  ('session_v2', 'camilajeffrey1@gmail.com', false),
  ('session_numbering_fix', 'camilajeffrey1@gmail.com', false),
  ('session_numbering_fix', 'googletest@gmail.com', false),
  ('session_numbering_fix', 'googletest@sellerflowlive.com', false),
  ('session_numbering_fix', 'cristycabanas34@gmail.com', false),
  ('session_numbering_fix', 'tincabanas13@gmail.com', false),
  ('session_numbering_fix', 'ronaldgantiga77@gmail.com', false),
  ('session_numbering_fix', 'aubreylucero15@yahoo.com', false),
  ('session_numbering_fix', '716030huan@gmail.com', false),
  ('session_numbering_fix', 'bardagulanjavier@gmail.com', false),
  ('session_numbering_fix', 'zandracruz@icloud.com', false),
  ('session_numbering_fix', 'chungmaychilleann@gmail.com', false),
  ('session_numbering_fix', 'gee383838@icloud.com', false),
  ('session_numbering_fix', 'rominamagat@gmail.com', false),
  ('session_numbering_fix', 'juvieho0725@gmail.com', false),
  ('session_numbering_fix', 'clarabhie@gmail.com', false),
  ('session_numbering_fix', 'mersteve17@gmail.com', false),
  ('session_numbering_fix', 'jinkyrosepenana@gmail.com', false),
  ('session_numbering_fix', 'basaomenchie6@gmail.com', false),
  ('session_numbering_fix', 'jaszhu127@gmail.com', false),
  ('session_numbering_fix', 'leinapan@gmail.com', false),
  ('session_numbering_fix', 'jobelleolivas80@gmail.com', false),
  ('session_numbering_fix', 'merriamalmirante194@gmail.com', false),
  ('session_numbering_fix', 'apzelejorde@yahoo.com', false),
  ('session_numbering_fix', 's076561908@hotmail.com', false),
  ('session_numbering_fix', 'ailun09291990@gmail.com', false),
  ('session_numbering_fix', 'ganggang0958@yahoo.com', false),
  ('session_numbering_fix', 'abeyverdera@yahoo.com', false),
  ('session_numbering_fix', 'christinechen769@gmail.com', false),
  ('session_numbering_fix', 'z30983359299@gmail.com', false),
  ('session_numbering_fix', 'vans0814@gmail.com', false),
  ('session_numbering_fix', 'rodelio.martinjr@gmail.com', false),
  ('session_numbering_fix', 'michellesebios86@gmail.com', false),
  ('session_numbering_fix', 'nashtex@abv.bg', false),
  ('session_numbering_fix', 'leahsangalang1215@gmail.com', false),
  ('session_numbering_fix', 'sanggalanglhea@gmail.com', false),
  ('session_numbering_fix', 'ukaydaily1@gmail.com', false),
  ('session_numbering_fix', 'lheyukay@gmail.com', false),
  ('session_numbering_fix', 'angelicasu08@gmail.com', false),
  ('classic_text', 'googletest@sellerflowlive.com', false),
  ('pin_print', 'budgetukay', true)  -- every budgetukay* account (the old prefix rule);
