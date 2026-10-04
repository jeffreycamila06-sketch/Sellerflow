-- 72 — BUYER ALERT, Phase 1 (alerts only). NOT APPLIED — written for review; apply separately.
-- Additive: one new table + one new RPC. Nothing existing is altered.
--
-- During a live the Dashboard warns the seller on comment rows about:
--   red   — a buyer with 3+ RETURNED parcels (minus the ones this seller forgave)
--   amber — a buyer with a parcel AT a 7-11 whose pickup_deadline is 0..3 days away (Asia/Taipei)
-- parcel_tracking is own-scoped by RLS, so the app reads through ONE SECURITY DEFINER RPC
-- (buyer_alert_lookup) that (a) refuses anyone outside the gate and (b) returns only what the
-- UI needs per buyer handle — never recipient_name / recipient_phone.
--
-- GATE: a SERVER-SIDE access list (the Parcel Check pattern, sql/70): admin OR an enabled row in
-- buyer_alert_access, read through buyer_alert_can_use(). Never an email rule — seller_profiles.email
-- is chosen by the user at sign-up. DATA OWNER (test phase): the rows of googletest@gmail.com.
-- Add a seller = one INSERT into buyer_alert_access (SQL only); they full-close + reopen the app.
-- ONE-LINE SWITCH to public: v_public := true → every signed-in seller, each reading their OWN rows
-- (flip BUYER_ALERT_PUBLIC in buyerAlert.ts at the same time).
--
-- Handle key = lower(strip one leading "@" from trim(buyer_username)) — the client normalises the
-- comment handle the same way; exact match only.
-- Retention (sql/65): picked_up rows live 7 days, returned rows 365 days → the FK cascade below
-- drops a forgive row together with its parcel.

-- ── 0) access list (rows added by SQL only) + the gate RPC ────────────────────
create table if not exists public.buyer_alert_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.buyer_alert_access enable row level security;
revoke all on public.buyer_alert_access from anon, authenticated;

-- The app asks this to decide whether to show Buyer Alert; buyer_alert_lookup() asks it too.
create or replace function public.buyer_alert_can_use()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_admin()
      or exists (select 1 from public.buyer_alert_access a
                  where a.user_id = auth.uid() and a.enabled);
$function$;
revoke all on function public.buyer_alert_can_use() from public, anon;
grant execute on function public.buyer_alert_can_use() to authenticated;

-- ── 1) forgive list (per seller) ─────────────────────────────────────────────
create table if not exists public.buyer_alert_forgive (
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parcel_tracking_id uuid not null references public.parcel_tracking(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (user_id, parcel_tracking_id)
);
create index if not exists buyer_alert_forgive_parcel_idx on public.buyer_alert_forgive (parcel_tracking_id); -- cascade on purge

alter table public.buyer_alert_forgive enable row level security;
create policy buyer_alert_forgive_select on public.buyer_alert_forgive
  for select using (user_id = auth.uid());
create policy buyer_alert_forgive_insert on public.buyer_alert_forgive
  for insert with check (user_id = auth.uid());
create policy buyer_alert_forgive_update on public.buyer_alert_forgive
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy buyer_alert_forgive_delete on public.buyer_alert_forgive
  for delete using (user_id = auth.uid());
revoke all on public.buyer_alert_forgive from anon;

-- ── 2) lookup map (one call at live start + every 10 min; zero per comment) ──
-- Returns { "<handle>": { returns, returned:[{id,returned_at,store,amount,forgiven}],
--                         near:[{store,deadline,days_left}], at_store, picked_up } }
-- Outside the gate → {}.
create or replace function public.buyer_alert_lookup()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_public      constant boolean := false;                   -- ← ONE-LINE SWITCH (BUYER_ALERT_PUBLIC)
  v_owner_email constant text    := 'googletest@gmail.com';  -- BUYER_ALERT_DATA_OWNER_EMAIL (test phase)
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_out   jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  if not v_public then
    if not public.buyer_alert_can_use() then
      return '{}'::jsonb;
    end if;
    select sp.auth_user_id into v_owner
      from public.seller_profiles sp where lower(btrim(sp.email)) = v_owner_email limit 1;
  else
    v_owner := v_uid;
  end if;
  if v_owner is null then return '{}'::jsonb; end if;

  with p as (
    select t.id,
           lower(regexp_replace(btrim(t.buyer_username), '^@', '')) as h,
           t.status, t.returned_at, t.order_amount, t.pickup_deadline,
           coalesce(nullif(btrim(t.rec_store), ''), t.store_id) as store,
           (f.parcel_tracking_id is not null) as forgiven
      from public.parcel_tracking t
      left join public.buyer_alert_forgive f
             on f.parcel_tracking_id = t.id and f.user_id = v_uid
     where t.user_id = v_owner                                -- EXPLICIT owner filter (DEFINER bypasses RLS)
       and t.buyer_username is not null
       and t.status in ('returned', 'at_store', 'picked_up')
  )
  select coalesce(jsonb_object_agg(x.h, x.obj), '{}'::jsonb) into v_out
    from (
      select p.h, jsonb_build_object(
        'returns',   count(*) filter (where p.status = 'returned' and not p.forgiven),
        'returned',  coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'returned_at', p.returned_at, 'store', p.store,
                                                           'amount', p.order_amount, 'forgiven', p.forgiven)
                                        order by p.returned_at desc nulls last) filter (where p.status = 'returned'), '[]'::jsonb),
        'near',      coalesce(jsonb_agg(jsonb_build_object('store', p.store, 'deadline', p.pickup_deadline,
                                                           'days_left', p.pickup_deadline - v_today)
                                        order by p.pickup_deadline)
                              filter (where p.status = 'at_store' and p.pickup_deadline - v_today between 0 and 3), '[]'::jsonb),
        'at_store',  count(*) filter (where p.status = 'at_store'),
        'picked_up', count(*) filter (where p.status = 'picked_up')
      ) as obj
        from p
       where p.h <> ''
       group by p.h
    ) x;
  return v_out;
end;
$function$;
revoke all on function public.buyer_alert_lookup() from public, anon;
grant execute on function public.buyer_alert_lookup() to authenticated;
