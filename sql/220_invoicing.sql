-- 220 — INVOICING, step 2a (TikTok "Send next", text): the switch, the preview key, the saved status,
--        the invoice shipping fee, the 3-month clean-up (Jeff, 2026-11-26).
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/220_invoicing_rollback.sql.
-- Needs sql/65, sql/74, sql/112, sql/206 (all live). Proof: scripts/sql220-behaviour.mjs (PGlite).
-- No Render deploy. Either order with the web is safe: before this file the switch row and the key do not
-- exist → Invoicing is closed for every seller (the Settings card is the "Soon" card of sql/219).
--
-- WHAT IT ADDS (nothing a seller can see changes by applying this file — the switch is created 'false'
-- and no login is on the preview list):
--   app_settings 'invoicing_enabled' = 'false'      Jeff's release switch (exactly 'true' = on, every plan)
--   feature key 'invoicing'                          one test login can see it before the switch
--                                                    (my_feature_access: the live 28 keys + this one)
--   public.invoice_sends                             the saved status of an invoice: ONE row per seller +
--                                                    session + platform + buyer number (+ buyer_key, a short
--                                                    one-way mark that keeps two buyers with the same number
--                                                    apart — two phones can give the same number twice).
--                                                    status sent | skipped, sent_at (database clock),
--                                                    lines_hash (the buyer's lines + total when it was sent).
--                                                    No name, no username, no message text.
--                                                    RLS: a seller reads and writes only own rows.
--   seller_receipt_settings.invoice_shipping_fee     the default shipping fee of an invoice (null = none).
--                                                    The Messenger receipt never reads it.
--   privacy_retention_purge()                        = the live text + ONE more loop: invoice_sends rows go
--                                                    3 months after their last change (the nightly job
--                                                    'privacy-retention-purge' itself is not touched).
-- NOT CHANGED: seller_receipt_settings' other columns and policies (the payment note stays the note the
--   Receipt format screen edits), every other switch, every other table, the cron schedule.
--
-- Turn on for everyone (Jeff):  update public.app_settings set value = 'true', updated_at = now() where key = 'invoicing_enabled';
-- One preview login:            insert into public.feature_access_emails (feature, email, is_prefix) values ('invoicing', '<login email>', false) on conflict do nothing;
begin;
set local lock_timeout = '3s';

-- ── 0) the live texts this file replaces (a = live 2026-11-26, b = this file) ─────────────────────────
do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'my_feature_access'
                    and md5(p.prosrc) in ('c2839ef78c5cd5c19b75a8d6a6f7f238', '6d7264ef44eefe70c1e836eb20709b82')) then
    raise exception 'sql/220: public.my_feature_access is not the text this file was made from — nothing was changed';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'privacy_retention_purge'
                    and md5(p.prosrc) in ('8b40e743b07ade1ace5208f73b23f9e8', 'be07f0fefb29068fe43482ed5babd71b')) then
    raise exception 'sql/220: public.privacy_retention_purge is not the text this file was made from — nothing was changed';
  end if;
end $guard$;

-- ── 1) the switch (never overwritten when it already exists) ─────────────────────────────────────────
insert into public.app_settings (key, value) values ('invoicing_enabled', 'false')
on conflict (key) do nothing;

-- ── 2) the preview key: the live 28 keys + 'invoicing' ───────────────────────────────────────────────
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact'), ('one_sticker'), ('sticker_all_scripts'), ('scan_qr_lookup'), ('fm_store_check'), ('printer_tester'), ('seller_website'), ('blacklist'), ('account_limits_v2'), ('shopee_public'), ('invoicing')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── 3) the saved status ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.invoice_sends (
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  session_key  text        not null,
  platform     text        not null,
  buyer_number integer     not null,
  buyer_key    text        not null default '',
  status       text        not null,
  sent_at      timestamptz,
  lines_hash   text        not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, session_key, platform, buyer_number, buyer_key),
  constraint invoice_sends_session_len check (char_length(session_key) between 1 and 80),
  constraint invoice_sends_platform    check (platform in ('tiktok', 'facebook', 'instagram', 'shopee')),
  constraint invoice_sends_number      check (buyer_number >= 0),
  constraint invoice_sends_key_shape   check (buyer_key ~ '^[0-9a-z]{0,24}$'),
  constraint invoice_sends_status      check (status in ('sent', 'skipped')),
  constraint invoice_sends_hash_shape  check (lines_hash ~ '^[0-9a-z]{0,24}$')
);
create index if not exists invoice_sends_updated_idx on public.invoice_sends (updated_at);
alter table public.invoice_sends enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_sends' and policyname = 'invoice_sends_select') then
    create policy invoice_sends_select on public.invoice_sends for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_sends' and policyname = 'invoice_sends_insert') then
    create policy invoice_sends_insert on public.invoice_sends for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_sends' and policyname = 'invoice_sends_update') then
    create policy invoice_sends_update on public.invoice_sends for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_sends' and policyname = 'invoice_sends_delete') then
    create policy invoice_sends_delete on public.invoice_sends for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.invoice_sends from public, anon;
grant select, insert, update, delete on public.invoice_sends to authenticated;

-- the times are the database's, never the phone's: sent_at = now() each time a row is saved as 'sent'
-- (a "Send again" moves it), null for 'skipped'; created_at is kept; updated_at = now().
create or replace function public.invoice_sends_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.sent_at := case when new.status = 'sent' then now() else null end;
  return new;
end;
$$;
drop trigger if exists trg_invoice_sends_stamp on public.invoice_sends;
create trigger trg_invoice_sends_stamp before insert or update on public.invoice_sends
  for each row execute function public.invoice_sends_stamp();

-- ── 4) the invoice shipping fee (one more column of the seller's own format row) ─────────────────────
alter table public.seller_receipt_settings add column if not exists invoice_shipping_fee numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_receipt_settings_invoice_fee') then
    alter table public.seller_receipt_settings
      add constraint seller_receipt_settings_invoice_fee check (invoice_shipping_fee is null or (invoice_shipping_fee >= 0 and invoice_shipping_fee <= 1000000));
  end if;
end $$;

-- ── 5) the nightly privacy clean-up: the live text + the invoice_sends loop ──────────────────────────
create or replace function public.privacy_retention_purge(p_batch integer default 5000)
returns jsonb language plpgsql set search_path = public as $$
declare
  n integer;
  v_orders integer := 0;
  v_scans integer := 0;
  v_tracking integer := 0;
  v_invoices integer := 0;   -- sql/220
begin
  loop
    delete from public.orders
     where id in (select id from public.orders
                   where created_at < now() - interval '3 months'
                   limit p_batch);
    get diagnostics n = row_count;
    v_orders := v_orders + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_scans
     where id in (select id from public.parcel_scans
                   where (exported_at is not null and exported_at < now() - interval '90 days')
                      or (exported_at is null and created_at < now() - interval '180 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_scans := v_scans + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_tracking
     where id in (select id from public.parcel_tracking
                   where (status = 'picked_up' and coalesce(picked_up_at, updated_at) < now() - interval '7 days')
                      or (status = 'returned'  and coalesce(returned_at,  updated_at) < now() - interval '365 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_tracking := v_tracking + n;
    exit when n < p_batch;
  end loop;

  -- sql/220: Invoicing send status, 3 months after its last change
  loop
    delete from public.invoice_sends
     where ctid in (select ctid from public.invoice_sends
                     where updated_at < now() - interval '3 months'
                     limit p_batch);
    get diagnostics n = row_count;
    v_invoices := v_invoices + n;
    exit when n < p_batch;
  end loop;

  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking, 'invoice_sends', v_invoices);
end;
$$;
revoke all on function public.privacy_retention_purge(integer) from public, anon, authenticated;

commit;

-- Apply check (each true):
--   select value = 'false' from public.app_settings where key = 'invoicing_enabled';
--   select public.my_feature_access() ? 'invoicing';
--   select not exists (select 1 from public.feature_access_emails where feature = 'invoicing');
--   select relrowsecurity from pg_class where oid = 'public.invoice_sends'::regclass;
--   select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'invoice_sends';
--   select not has_table_privilege('anon', 'public.invoice_sends', 'select');
--   select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'seller_receipt_settings' and column_name = 'invoice_shipping_fee');
--   select md5(prosrc) = 'be07f0fefb29068fe43482ed5babd71b' from pg_proc where proname = 'privacy_retention_purge';
