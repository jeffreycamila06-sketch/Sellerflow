-- sql/233 — Invoicing → Facebook: the seller's own edits of ONE buyer's Messenger receipt (2026-11-27).
--
-- The Facebook tab of Settings → Invoicing opens the same receipt editor as Orders (opening, item lines,
-- shipping fee, note — the payment QR stays the saved one). An edit is saved here (one row per seller +
-- session + buyer number); "Send all" and the single Send of that tab (server/fbSendAll.js) draw the picture
-- from this row when there is one, else from the orders as before. "Reset to original" deletes the row.
-- Nothing here changes an order, Sales, a sticker or the saved receipt format.
--
--   public.fb_receipt_edits   NEW. opening / note: the texts of THIS receipt. lines: [{ "item": text,
--                             "price": number | null }] in the order shown (null = the price box was left
--                             empty). shipping_fee: null = none. based_on: a short code of the buyer's order
--                             lines when the edit was made (the app shows "new order since your edit" when it
--                             no longer matches; the server never reads it). updated_at = the database's time.
--                             RLS: a seller reads / adds / changes / deletes ONLY own rows; a visitor
--                             (anon) has no access at all. The server reads it with the service role.
--   fb_receipt_edit_lines_ok  the lines check (an array of at most 100 { item ≤ 200 chars, price 0..100,000,000
--                             or null } objects, nothing else).
--   cron purge-old-fb-receipt-edits  rows go 3 months after their last change (as invoice_sends).
--
-- No other table, function or setting is changed. Rollback: sql/233_fb_receipt_edits_rollback.sql.
begin;
set local lock_timeout = '3s';

create or replace function public.fb_receipt_edit_lines_ok(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select p is not null
     and jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 100
     and octet_length(p::text) <= 40000
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('item', 'price'))
           or jsonb_typeof(e -> 'item') is distinct from 'string'
           or char_length(e ->> 'item') > 200
           or (e ? 'price' and jsonb_typeof(e -> 'price') not in ('number', 'null'))
           or (jsonb_typeof(e -> 'price') = 'number' and ((e ->> 'price')::numeric < 0 or (e ->> 'price')::numeric > 100000000))
     )
$$;

create table if not exists public.fb_receipt_edits (
  user_id       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  session_id    uuid        not null,
  buyer_number  integer     not null,
  opening       text        not null default '',
  lines         jsonb       not null default '[]'::jsonb,
  shipping_fee  numeric,
  note          text        not null default '',
  based_on      text,
  updated_at    timestamptz not null default now(),
  primary key (user_id, session_id, buyer_number),
  constraint fb_receipt_edits_buyer    check (buyer_number between 1 and 1000000),
  constraint fb_receipt_edits_opening  check (char_length(opening) <= 300),
  constraint fb_receipt_edits_note     check (char_length(note) <= 1000),
  constraint fb_receipt_edits_lines    check (public.fb_receipt_edit_lines_ok(lines)),
  constraint fb_receipt_edits_shipping check (shipping_fee is null or (shipping_fee >= 0 and shipping_fee <= 100000000)),
  constraint fb_receipt_edits_based_on check (based_on is null or based_on ~ '^[0-9a-z]{1,40}$')
);
create index if not exists fb_receipt_edits_updated_idx on public.fb_receipt_edits (updated_at);
alter table public.fb_receipt_edits enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_receipt_edits' and policyname = 'fb_receipt_edits_select') then
    create policy fb_receipt_edits_select on public.fb_receipt_edits for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_receipt_edits' and policyname = 'fb_receipt_edits_insert') then
    create policy fb_receipt_edits_insert on public.fb_receipt_edits for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_receipt_edits' and policyname = 'fb_receipt_edits_update') then
    create policy fb_receipt_edits_update on public.fb_receipt_edits for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_receipt_edits' and policyname = 'fb_receipt_edits_delete') then
    create policy fb_receipt_edits_delete on public.fb_receipt_edits for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.fb_receipt_edits from public, anon;
grant select, insert, update, delete on public.fb_receipt_edits to authenticated;
revoke execute on function public.fb_receipt_edit_lines_ok(jsonb) from public, anon;
grant execute on function public.fb_receipt_edit_lines_ok(jsonb) to authenticated;

-- the time is the database's, never the phone's (the 3-month clean-up reads it)
create or replace function public.fb_receipt_edits_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_fb_receipt_edits_stamp on public.fb_receipt_edits;
create trigger trg_fb_receipt_edits_stamp before insert or update on public.fb_receipt_edits
  for each row execute function public.fb_receipt_edits_stamp();

-- 3 months after the last change (01:55 Taipei); the job is skipped where pg_cron is not installed
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-old-fb-receipt-edits', '55 17 * * *',
      $q$delete from public.fb_receipt_edits where updated_at < now() - interval '3 months'$q$);
  end if;
end $$;

commit;
