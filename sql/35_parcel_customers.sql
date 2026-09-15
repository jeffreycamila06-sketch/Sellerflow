-- 35_parcel_customers.sql
-- CUSTOMER DETAILS — a phonebook of parcel buyers, auto-populated from the
-- Parcel Scan encode flow so a seller can re-import a repeat buyer without
-- re-typing name / phone / store / notes.
--
-- Applied to prod via Supabase MCP 2026-09-15 (this file is the repo MIRROR —
-- parcel_scans / seller_shipping_settings pattern; backfill of existing
-- parcel_scans already run = 78 rows).
--
-- SEPARATE from the live-selling CRM `customers` table (keyed by handle) — this
-- one is keyed per (user_id, phone, name) so the SAME phone with a DIFFERENT
-- name is TWO records (e.g. Pedro & Maria sharing one household phone).
--
-- Population is 100% trigger-driven off parcel_scans (scan / manual / import all
-- go through the one INSERT path) — there is NO app-side upsert. Egress shape:
-- one search select + one recent select per Customer-Details open, plus the
-- per-encode trigger write. ZERO poll.

create extension if not exists pg_trgm;

create table if not exists public.parcel_customers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  phone      text not null,
  name       text,
  store_id   text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- UNIQUE KEY: same phone + different name = two entries (Pedro & Maria on one
-- household phone are two records). name normalized (lower + trimmed, null → '').
create unique index if not exists parcel_customers_uniq
  on public.parcel_customers (user_id, phone, lower(trim(coalesce(name, ''))));

-- Trigram GIN over name+phone+notes for the leading-wildcard ilike search
-- (btree can't serve `%q%`). notes holds the buyer's TikTok handle.
create index if not exists parcel_customers_search
  on public.parcel_customers
  using gin ((coalesce(name, '') || ' ' || phone || ' ' || coalesce(notes, '')) gin_trgm_ops);

create index if not exists parcel_customers_user_updated
  on public.parcel_customers (user_id, updated_at desc);

alter table public.parcel_customers enable row level security;

create policy parcel_customers_select on public.parcel_customers
  for select using (user_id = auth.uid());
create policy parcel_customers_insert on public.parcel_customers
  for insert with check (user_id = auth.uid());
create policy parcel_customers_update on public.parcel_customers
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy parcel_customers_delete on public.parcel_customers
  for delete using (user_id = auth.uid());

-- ── Trigger: keep the phonebook in sync with every parcel encode ────────────
-- AFTER INSERT OR UPDATE OF the four buyer fields on parcel_scans → upsert into
-- parcel_customers. A blank store_id / notes on the incoming row does NOT
-- overwrite an existing value (coalesce keeps the old one); a blank phone is
-- ignored entirely (no phonebook entry without a phone).
create or replace function public.upsert_parcel_customer()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  if new.phone is null or trim(new.phone) = '' then
    return new;
  end if;
  insert into public.parcel_customers (user_id, phone, name, store_id, notes, updated_at)
  values (
    new.user_id,
    trim(new.phone),
    nullif(trim(coalesce(new.customer_name,'')), ''),
    nullif(trim(coalesce(new.store_id,'')), ''),
    nullif(trim(coalesce(new.notes,'')), ''),
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id   = coalesce(excluded.store_id, parcel_customers.store_id),
        notes      = coalesce(excluded.notes,    parcel_customers.notes),
        updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_upsert_parcel_customer on public.parcel_scans;
create trigger trg_upsert_parcel_customer
  after insert or update of customer_name, phone, store_id, notes
  on public.parcel_scans
  for each row execute function public.upsert_parcel_customer();
