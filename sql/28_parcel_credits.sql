-- ============================================================================
-- 28_parcel_credits.sql — Parcel Scan credit system, Part 1 (race-safe backend)
--
-- ✅ APPLIED to production (Supabase MCP, migration `parcel_credits`) 2026-09-08.
--    This file is the repo mirror of the live state.
--
-- Wallet (cached balance) + append-only ledger (source of truth) + three
-- SECURITY DEFINER RPCs. This is REAL MONEY (each AI scan costs the owner, sold
-- to sellers as "scan credits"), so the debit mirrors check_and_export_shipping's
-- atomicity — pg_advisory_xact_lock + a GUARDED conditional UPDATE + a row_count
-- guard — NOT check_and_increment_free_order's read-then-act shape (that has a
-- check-then-act race that is unacceptable for money).
--
-- WRITE LOCKDOWN (the sql/16 lesson): the wallet balance + the ledger get ZERO
-- client write grant. RLS blocks writes (no write policy) AND the default
-- table-level INSERT/UPDATE/DELETE grants to authenticated/anon are REVOKEd
-- (a table-level privilege can override a column revoke — sql/16). The ONLY
-- writers are the three SECURITY DEFINER RPCs (they run as owner, bypass RLS).
-- ============================================================================

-- ── Wallet: one cached balance per user (the ledger is the source of truth) ──
create table if not exists public.parcel_credit_wallet (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ── Ledger: append-only audit trail; every grant/topup/debit/refund is a row ──
create table if not exists public.parcel_credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  delta         integer not null,
  reason        text not null check (reason in ('grant','topup','scan_debit','refund')),
  scan_id       uuid null references public.parcel_scans(id) on delete set null,
  balance_after integer,
  created_at    timestamptz not null default now()
);
create index if not exists idx_pcl_user_created on public.parcel_credit_ledger (user_id, created_at desc);

alter table public.parcel_credit_wallet enable row level security;
alter table public.parcel_credit_ledger enable row level security;

-- SELECT own-or-admin. NO insert/update/delete policy → those commands are
-- denied by RLS for the API roles; the SECURITY DEFINER RPCs (owner) are the
-- only writers.
drop policy if exists pcw_select on public.parcel_credit_wallet;
create policy pcw_select on public.parcel_credit_wallet
  for select using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists pcl_select on public.parcel_credit_ledger;
create policy pcl_select on public.parcel_credit_ledger
  for select using (user_id = (select auth.uid()) or public.is_admin());

-- sql/16 lesson — revoke the leaked table-level write privileges (SELECT stays,
-- RLS scopes it). Verified live: authenticated/anon end with SELECT (+ harmless
-- REFERENCES/TRIGGER) only; INSERT/UPDATE/DELETE/TRUNCATE gone.
revoke insert, update, delete, truncate on public.parcel_credit_wallet from authenticated, anon;
revoke insert, update, delete, truncate on public.parcel_credit_ledger from authenticated, anon;

-- ── RPC: atomic check-and-debit (the credit spend) ───────────────────────────
-- pg_advisory_xact_lock serializes one user's calls; the conditional UPDATE
-- (WHERE balance >= p_amount) + row_count guard is the atomic check — two
-- devices can never both pass the same remaining balance, and balance can never
-- go negative. NOT read-then-act.
create or replace function public.check_and_debit_credit(p_amount integer default 1)
  returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  n      integer;
  bal    integer;
  cur    integer;
begin
  if caller is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_amount is null or p_amount <= 0 then return json_build_object('ok', false, 'error', 'bad_amount'); end if;

  perform pg_advisory_xact_lock(hashtext('parcel_credit_' || caller::text));

  -- Ensure a wallet row exists so the guarded UPDATE has a row to lock.
  insert into public.parcel_credit_wallet (user_id, balance) values (caller, 0)
    on conflict (user_id) do nothing;

  update public.parcel_credit_wallet
     set balance = balance - p_amount, updated_at = now()
   where user_id = caller and balance >= p_amount
   returning balance into bal;
  get diagnostics n = row_count;

  if n = 0 then
    select balance into cur from public.parcel_credit_wallet where user_id = caller;
    return json_build_object('ok', false, 'error', 'insufficient_credits', 'balance', coalesce(cur, 0));
  end if;

  insert into public.parcel_credit_ledger (user_id, delta, reason, balance_after)
    values (caller, -p_amount, 'scan_debit', bal);

  return json_build_object('ok', true, 'balance', bal);
end;
$function$;

-- ── RPC: admin grant / top-up (manual Wise/Telegram flow) ────────────────────
-- is_admin()-gated. Resolves the target from seller_profiles by email; upsert +
-- ledger row in one transaction.
create or replace function public.grant_parcel_credit(p_email text, p_amount integer, p_reason text default 'topup')
  returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  target uuid;
  bal    integer;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then return json_build_object('ok', false, 'error', 'bad_amount'); end if;
  if p_reason not in ('grant', 'topup') then return json_build_object('ok', false, 'error', 'bad_reason'); end if;

  select auth_user_id into target from public.seller_profiles where email = lower(trim(p_email));
  if target is null then return json_build_object('ok', false, 'error', 'user_not_found'); end if;

  perform pg_advisory_xact_lock(hashtext('parcel_credit_' || target::text));

  insert into public.parcel_credit_wallet (user_id, balance) values (target, p_amount)
    on conflict (user_id) do update set balance = public.parcel_credit_wallet.balance + p_amount, updated_at = now()
  returning balance into bal;

  insert into public.parcel_credit_ledger (user_id, delta, reason, balance_after)
    values (target, p_amount, p_reason, bal);

  return json_build_object('ok', true, 'email', lower(trim(p_email)), 'balance', bal);
end;
$function$;

-- ── RPC: refund one failed scan (server calls this after a 502-class failure) ─
-- ⚠️ PART-2 HARDENING NOTE: refund credits the CALLER (auth.uid()). Today the
-- whole feature is admin-only (route requireAdmin + canUseParcelScan admin-only),
-- so the only caller is the trusted owner. BEFORE Part 2 opens Parcel Scan to
-- sellers, this must be gated (e.g. refund only up to the caller's outstanding
-- unrefunded scan_debits, or a server-authority path) — otherwise a seller could
-- call it directly to self-credit. Left caller-scoped per the Part-1 spec.
create or replace function public.refund_parcel_credit(p_amount integer default 1, p_scan_id uuid default null)
  returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  bal    integer;
begin
  if caller is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_amount is null or p_amount <= 0 then return json_build_object('ok', false, 'error', 'bad_amount'); end if;

  perform pg_advisory_xact_lock(hashtext('parcel_credit_' || caller::text));

  insert into public.parcel_credit_wallet (user_id, balance) values (caller, p_amount)
    on conflict (user_id) do update set balance = public.parcel_credit_wallet.balance + p_amount, updated_at = now()
  returning balance into bal;

  insert into public.parcel_credit_ledger (user_id, delta, reason, scan_id, balance_after)
    values (caller, p_amount, 'refund', p_scan_id, bal);

  return json_build_object('ok', true, 'balance', bal);
end;
$function$;

-- EXECUTE: authenticated only (the server calls with the caller's JWT = the
-- authenticated role; grant_parcel_credit is is_admin()-gated inside). Never anon.
revoke all on function public.check_and_debit_credit(integer) from public, anon;
revoke all on function public.grant_parcel_credit(text, integer, text) from public, anon;
revoke all on function public.refund_parcel_credit(integer, uuid) from public, anon;
grant execute on function public.check_and_debit_credit(integer) to authenticated;
grant execute on function public.grant_parcel_credit(text, integer, text) to authenticated;
grant execute on function public.refund_parcel_credit(integer, uuid) to authenticated;
