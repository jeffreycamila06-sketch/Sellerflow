-- ============================================================================
-- 30_parcel_scan_outcome.sql — per-scan outcome tracking for Parcel Scan credits.
--
-- ✅ APPLIED to production (Supabase MCP, migration `parcel_scan_outcome`)
--    2026-09-08. Repo mirror of the live state.
--
-- Records WHY a scan_debit did or didn't get refunded, so the admin dashboard can
-- show success vs bad_photo (charged, seller's own unreadable slip) vs technical
-- (refunded). The credit ledger previously only had scan_debit + refund rows, so
-- bad-photo failures were invisible.
--
-- ⚠️ Set ONLY on scan_debit rows. NULL for grant/topup/refund rows AND for every
-- scan_debit written BEFORE this feature deployed (pre-feature = "untracked" — the
-- dashboard counts those separately, never as success or bad_photo). The atomic
-- check_and_debit_credit guard is UNTOUCHED — the debit row is written there first,
-- and the server stamps the outcome afterward (keyed by the debit_id it already
-- threads) via the RPC below, because the wallet/ledger have zero client write
-- grant (an RPC is the only writer).
-- ============================================================================
alter table public.parcel_credit_ledger
  add column if not exists outcome text null
  check (outcome in ('success','bad_photo','technical'));

-- Stamp the outcome on the CALLER'S OWN scan_debit row, by id. Own-scoped
-- (user_id = auth.uid()); only scan_debit rows are stampable; an unknown outcome
-- or a row that isn't the caller's scan_debit → ok:false, nothing written.
-- Best-effort from the server: a failed stamp never breaks the scan or the debit.
create or replace function public.set_scan_outcome(p_debit_id uuid, p_outcome text)
  returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  n      integer;
begin
  if caller is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_debit_id is null then return json_build_object('ok', false, 'error', 'no_debit_id'); end if;
  if p_outcome not in ('success','bad_photo','technical') then
    return json_build_object('ok', false, 'error', 'bad_outcome');
  end if;

  update public.parcel_credit_ledger
     set outcome = p_outcome
   where id = p_debit_id and user_id = caller and reason = 'scan_debit';
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'error', 'no_scan_debit'); end if;

  return json_build_object('ok', true);
end;
$function$;

revoke all on function public.set_scan_outcome(uuid, text) from public, anon;
grant execute on function public.set_scan_outcome(uuid, text) to authenticated;
