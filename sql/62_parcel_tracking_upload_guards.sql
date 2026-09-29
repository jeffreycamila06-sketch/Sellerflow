-- 62 — Parcel Tracking Stage-1b (upload guards). MIRROR of the migration applied via MCP.
--
-- S3 wrong-shop upload: the 賣貨便 匯出報表 export carries NO reliable shop identity
-- (row 1 = an order-date filter banner; the filename is a random per-export token;
-- 商品名稱 holds whatever the order was created with). So a wrong-shop upload is
-- detected by COLLISION: a tracking number (交貨便 code) belongs to exactly one shop,
-- so a code that already sits under ANOTHER seller means the file is not this seller's.
--
-- 1) parcel_tracking_foreign_overlap(p_codes text[]) → integer
--    How many of these codes already belong to a DIFFERENT seller. Called by the app
--    BEFORE any write, so a wrong-shop file is blocked with nothing saved. Returns a
--    COUNT only (never whose). Callable only by an allowlisted seller (sql/60) or an
--    admin — anyone else gets 42501 (the app shows "Your plan doesn't include Pickup
--    Status"). ≤ 10,000 codes per call.
-- 2) BEFORE INSERT trigger on parcel_tracking (server-side backstop — a forged client
--    that skips the pre-check still can't write):
--      • a JWT caller not on the allowlist (and not admin) → 42501 not_allowed
--      • a tracking_no that already belongs to another seller → P0001 foreign_tracking_no
--    Service-role writes (the poller; auth.uid() is null) are exempt. SECURITY DEFINER
--    so the check can see other sellers' rows (RLS would hide them).
-- 3) index on tracking_no for both lookups.

create index if not exists parcel_tracking_tracking_no_idx on public.parcel_tracking (tracking_no);

create or replace function public.parcel_tracking_upload_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.parcel_tracking_access a where a.user_id = auth.uid() and a.enabled)
    or public.is_admin()
  );
$$;
revoke all on function public.parcel_tracking_upload_allowed() from public, anon, authenticated;

create or replace function public.parcel_tracking_foreign_overlap(p_codes text[])
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.parcel_tracking_upload_allowed() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_codes), 0) > 10000 then
    raise exception 'too_many_codes' using errcode = '22023';
  end if;
  return (
    select count(distinct t.tracking_no)::integer
      from public.parcel_tracking t
     where t.tracking_no = any(p_codes)
       and t.user_id <> auth.uid()
  );
end;
$$;
revoke all on function public.parcel_tracking_foreign_overlap(text[]) from public, anon;
grant execute on function public.parcel_tracking_foreign_overlap(text[]) to authenticated;

create or replace function public.parcel_tracking_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role (poller / admin tooling)
  end if;
  if not public.parcel_tracking_upload_allowed() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.parcel_tracking t
     where t.tracking_no = new.tracking_no and t.user_id <> new.user_id
  ) then
    raise exception 'foreign_tracking_no' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.parcel_tracking_guard_insert() from public, anon, authenticated;

drop trigger if exists trg_parcel_tracking_guard_insert on public.parcel_tracking;
create trigger trg_parcel_tracking_guard_insert
  before insert on public.parcel_tracking
  for each row execute function public.parcel_tracking_guard_insert();
