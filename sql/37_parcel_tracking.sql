-- 37_parcel_tracking.sql
-- 7-11 賣貨便 PICKUP TRACKING ("Pickup Status / Chase Buyer"). Phase 1 = OWNER +
-- googletest only (client tile/screen gated by parcelTrackingVisible; the poll
-- endpoint gated by a server secret). This file is the repo MIRROR of what is
-- applied to prod via Supabase MCP — do NOT re-apply. ADDITIVE ONLY.
--
-- WHAT IT IS: one row per parcel tracked by its 交貨便服務代碼 (F-code). The
-- Chrome extension's order-list scraper upserts raw scraped rows (tracking_no,
-- cm_order_no, recipient_name, store_id, order_amount) via Supabase REST under the
-- seller's own RLS — SAME auth path as the existing parcel_scans writeback (no
-- server ingest route). A Render poller (server secret, service role) then fills
-- status / arrived_at / pickup_deadline from SHOPMORE and flips `terminal` when a
-- parcel is picked up or returned.
--
-- ⚠️ cm_order_no is METADATA ONLY. shipping_entries has NO CM column (CM is minted
-- by 賣貨便 only AFTER upload — the app never sees it at export), so it can never
-- be the join key. The buyer-username link is by recipient_name + store_id +
-- order_amount against the seller's own shipping_entries (the fields both sides
-- actually carry; the order-list scraper does not capture phone).
--
-- EGRESS: the app reads this table with ONE own-scoped select on screen open
-- (zero poll). The extension write + the poller are the only writers.

create table if not exists public.parcel_tracking (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  tracking_no       text not null,                       -- 交貨便服務代碼 (F-code) — the SHOPMORE PaymentNo
  cm_order_no       text,                                -- 賣貨便訂單編號 CM… (metadata / reference only — NOT a join key)
  shipping_entry_id uuid references public.shipping_entries(id) on delete set null,
  buyer_username    text,                                -- copied from the linked shipping_entries row
  recipient_name    text,
  store_id          text,
  status            text not null default 'created'
                    check (status in ('created','in_transit','at_store','picked_up','returned','not_found','unknown')),
  status_message    text,                                -- raw SHOPMORE statusMessage (also lets us learn new strings)
  arrived_at        timestamptz,                         -- set once, when first seen at_store
  pickup_deadline   date,                                -- SHOPMORE recDate — given directly (only set at store)
  rec_store         text,
  order_amount      numeric,
  last_polled_at    timestamptz,
  terminal          boolean not null default false,      -- picked_up / returned → stop polling
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, tracking_no)                          -- idempotent re-paste / re-scrape
);

-- Poll select ("which of my rows are still live?") + screen select (soonest
-- deadline first) both filter by user_id + terminal and sort by deadline.
create index if not exists parcel_tracking_user_live_idx
  on public.parcel_tracking (user_id, terminal, pickup_deadline);

alter table public.parcel_tracking enable row level security;

-- Own-scoped RLS (the four-policy shape every per-seller table uses). The extension
-- carries the seller's JWT, so it can only ever write its own rows; the app reads
-- only its own. The poller runs as SERVICE ROLE (bypasses RLS) and MUST filter by
-- explicit user_id in every query (the Miners lesson) — RLS is not its guard.
create policy parcel_tracking_select on public.parcel_tracking
  for select using (user_id = auth.uid());
create policy parcel_tracking_insert on public.parcel_tracking
  for insert with check (user_id = auth.uid());
create policy parcel_tracking_update on public.parcel_tracking
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy parcel_tracking_delete on public.parcel_tracking
  for delete using (user_id = auth.uid());

-- ── Trigger: link a tracked parcel to its shipping_entries row (buyer_username) ──
-- BEFORE INSERT OR UPDATE. SECURITY INVOKER (never DEFINER — no RLS-bypass surface;
-- the read is naturally own-scoped under the writer's RLS, AND we filter by an
-- EXPLICIT se.user_id = new.user_id so it stays correct even when the poller writes
-- as service role). Links ONLY when not already linked and all three match fields
-- are present; takes the newest on a rare tie (deterministic, never a wrong-user
-- row). A no-match leaves buyer_username null — the row is still valid + trackable.
-- Also refreshes updated_at on every write.
create or replace function public.link_parcel_tracking()
  returns trigger
  language plpgsql
  security invoker
  set search_path to 'public'
as $function$
declare
  v_entry record;
begin
  if new.shipping_entry_id is null
     and new.store_id is not null and trim(new.store_id) <> ''
     and new.order_amount is not null
     and new.recipient_name is not null and trim(new.recipient_name) <> '' then
    select se.id as id, se.buyer_username as buyer_username
      into v_entry
      from public.shipping_entries se
     where se.user_id = new.user_id
       and se.store_id = new.store_id
       and se.order_amount = new.order_amount
       and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
     order by se.created_at desc
     limit 1;
    if found then
      new.shipping_entry_id := v_entry.id;
      new.buyer_username := coalesce(new.buyer_username, v_entry.buyer_username);
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_link_parcel_tracking on public.parcel_tracking;
create trigger trg_link_parcel_tracking
  before insert or update on public.parcel_tracking
  for each row execute function public.link_parcel_tracking();
