-- 36_parcel_customers_filters.sql
-- CUSTOMER DETAILS phonebook — negative-verdict filtering on the auto-populate
-- trigger. Applied to prod via Supabase MCP (this file is the byte-exact repo
-- mirror of the live function + trigger — fetched via
-- pg_get_functiondef('public.upsert_parcel_customer') and pg_get_triggerdef).
--
-- Supersedes the trigger/function shipped in sql/35. Two new rules keep bad
-- buyers OUT of (or OFF) the phonebook, plus the trigger now also fires when the
-- verdict columns change:
--   Rule 1 — store code came back explicitly NON-VALID (not in
--            'valid' / 'unchecked' / 'unknown') → do NOT add. This is the
--            wrong-store-code case ('not_found', see the app note below).
--   Rule 2 — the buyer's phone came back 'restricted' → DELETE the matching
--            phonebook row (user_id, phone, normalized name). A restricted buyer
--            is removed from re-import entirely.
-- Store FULL is deliberately NOT a skip reason (a full store is transient — the
-- buyer/phone are still good), so store_full_status is not in the trigger's
-- UPDATE OF list and neither rule looks at it.
--
-- ── APP write verification (adapters/parcelScan.ts) ─────────────────────────
-- The SOLE writer of parcel_scans.store_check_status is saveStoreCheck(), whose
-- value comes from checkEmapStore() (the E-Map scan-time pre-check). checkEmapStore
-- returns EXACTLY one of:
--     'valid'      — store code valid
--     'not_found'  — wrong store code (E-Map: code does not exist)
--     'unknown'    — can't verify (403 / network / non-6-digit / non-ok)
-- ('checking' is a LOCAL transient only — saveStoreCheck returns early and never
-- persists it.) The column is also NULL when never checked.
-- Against Rule 1's allow-list ('valid','unchecked','unknown'):
--     'valid'   → allowed  → add (correct)
--     'unknown' → allowed  → add (can't-verify ≠ problem; matches the export
--                            "unknown/null → READY" behaviour)
--     NULL      → allowed  → add (unchecked)
--     'not_found' → NOT allowed → SKIP (correct — this is the only negative the
--                            app writes, and it is exactly the maling-store-code
--                            case Rule 1 targets)
-- ⇒ Rule 1 matches the app EXACTLY. There is NO app-written value that should be
--   treated as non-negative yet falls outside the allow-list. ('unchecked' is in
--   the allow-list but the app never writes it — a harmless, safe-direction
--   future-proof allowance.) Nothing to flag; live DB left unchanged.
-- The extension (sql/33) writes store_full_status / phone_check_status, NOT
-- store_check_status — so the app's saveStoreCheck stays the only writer of it.

create or replace function public.upsert_parcel_customer()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_name  text := nullif(trim(coalesce(new.customer_name, '')), '');
begin
  if v_phone = '' then
    return new;
  end if;

  -- Rule 2: restricted verdict arrived → remove this buyer from the phonebook.
  if new.phone_check_status = 'restricted' then
    delete from public.parcel_customers
     where user_id = new.user_id
       and phone = v_phone
       and lower(trim(coalesce(name, ''))) = lower(trim(coalesce(v_name, '')));
    return new;
  end if;

  -- Rule 1: explicit non-valid store check → do not add.
  if new.store_check_status is not null
     and new.store_check_status not in ('valid', 'unchecked', 'unknown') then
    return new;
  end if;

  insert into public.parcel_customers (user_id, phone, name, store_id, notes, updated_at)
  values (
    new.user_id,
    v_phone,
    v_name,
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

-- Trigger now also fires on UPDATE OF store_check_status / phone_check_status so
-- a late verdict (the extension or the E-Map re-check) can apply Rule 1 / Rule 2.
drop trigger if exists trg_upsert_parcel_customer on public.parcel_scans;
create trigger trg_upsert_parcel_customer
  after insert or update of customer_name, phone, store_id, notes, store_check_status, phone_check_status
  on public.parcel_scans
  for each row execute function public.upsert_parcel_customer();
