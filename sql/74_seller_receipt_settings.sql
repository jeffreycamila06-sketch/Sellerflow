-- 74 — FACEBOOK RECEIPTS, format phase. APPLIED in production, Oct 5 2026.
-- Additive and idempotent. Nothing is sent to anyone; this only stores what the seller types.
--
-- seller_receipt_settings: one row per seller with the receipt's opening text, note (how to
-- pay) and the seller's OWN payment QR picture as a data URL (the app downscales it to
-- ≤ 600px and ≤ 300 KB before saving; the check below allows up to 400 000 characters).
-- Read and written by the seller's own app session only (owner-only RLS).
-- If this is not applied yet, the Receipt format screen shows an error note and nothing
-- else in the app is affected.

create table if not exists public.seller_receipt_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  opening    text not null default '',
  note       text not null default '',
  qr_image   text,
  updated_at timestamptz not null default now(),
  constraint seller_receipt_settings_opening_len check (char_length(opening) <= 300),
  constraint seller_receipt_settings_note_len    check (char_length(note) <= 1000),
  constraint seller_receipt_settings_qr_len      check (qr_image is null or char_length(qr_image) <= 400000)
);
alter table public.seller_receipt_settings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'seller_receipt_settings' and policyname = 'srs_select') then
    create policy srs_select on public.seller_receipt_settings for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'seller_receipt_settings' and policyname = 'srs_insert') then
    create policy srs_insert on public.seller_receipt_settings for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'seller_receipt_settings' and policyname = 'srs_update') then
    create policy srs_update on public.seller_receipt_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'seller_receipt_settings' and policyname = 'srs_delete') then
    create policy srs_delete on public.seller_receipt_settings for delete using (auth.uid() = user_id);
  end if;
end $$;
revoke all on public.seller_receipt_settings from anon;
