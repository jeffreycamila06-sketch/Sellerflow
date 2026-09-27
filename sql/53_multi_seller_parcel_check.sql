-- MULTI-SELLER E-MAP / RESTRICTED-PHONE CHECK (2026-09-27) — extension-as-
-- shared-worker. The owner's extension polls a FAIR cross-seller queue via two
-- admin-gated SECURITY DEFINER RPCs; every check uses the parcel OWNER's own
-- GM id + phone (attribution is enforced STRUCTURALLY: the pending RPC inner-
-- joins the config table, so an unconfigured seller's rows can never be
-- selected — never checked via someone else's GM).
--
-- Probe-proven facts this design rests on (2026-09-27 investigation):
--   • the GM cart page + CheckoutValidation work ANONYMOUSLY (no myship login);
--   • restriction verdicts are PLATFORM-WIDE per buyer phone → cacheable;
--   • ord_mobile is NOT validated against the GM (a typo cannot poison a
--     verdict) — the per-seller GM rule is IP/reputation attribution hygiene.
--
-- Kill switch: app_settings 'parcel_check_multi_enabled' (the
-- parcel_manual_enabled pattern) — seeded 'false' (fail-closed); the pending
-- RPC returns an empty set while off. Two more gates sit in front anyway:
-- the client Settings allowlist (PARCEL_CHECK_PUBLIC flip) and the
-- extension's multiSeller flag (default OFF).
--
-- APPLIED to production via Supabase MCP (this file = the repo mirror).

-- ── 1. Per-seller config (the raffle_config / seller_shipping_settings pattern) ──
create table if not exists public.seller_myship_config (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  gm_id       text not null,
  ord_mobile  text not null,
  shop_name   text,
  verified_at timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.seller_myship_config enable row level security;
create policy smc_select on public.seller_myship_config for select using (user_id = (select auth.uid()));
create policy smc_insert on public.seller_myship_config for insert with check (user_id = (select auth.uid()));
create policy smc_update on public.seller_myship_config for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy smc_delete on public.seller_myship_config for delete using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.seller_myship_config to authenticated;

-- ── 2. Phone-verdict cache — platform-wide facts, deliberately UNATTRIBUTED
--      (no seller column) and ZERO client access: RLS on with NO policies
--      (deny-all belt) + revoked grants; only the DEFINER RPCs touch it. ──
create table if not exists public.phone_check_cache (
  phone            text primary key,
  status           text not null check (status in ('ok','restricted')),
  message          text,
  restricted_until date,
  checked_at       timestamptz not null default now()
);
alter table public.phone_check_cache enable row level security;
revoke all on public.phone_check_cache from anon, authenticated;

-- ── 3. Seed the kill switch (fail-closed; flip to 'true' to start dogfood) ──
insert into public.app_settings(key, value) values ('parcel_check_multi_enabled', 'false')
on conflict (key) do nothing;

-- CHECK_SENDER_PHONE (2026-09-27): ONE clean sender (ordMobile) for ALL checks,
-- regardless of seller. Many sellers are themselves 7-11-restricted (reported by
-- no-show buyers) and a restricted ordMobile poisons every buyer verdict; a fixed
-- clean sender sidesteps it (probe-proven: ordMobile is NOT cross-validated
-- against the GM, so any clean sender works with any GM, and no order is created).
-- Admin-swappable; swap to a dedicated clean check account before public rollout.
--   parcel_check_probe_buyer  = a KNOWN-CLEAN buyer used only by the sender
--       health-check (validate this buyer through the sender; if it comes back
--       'restricted' the SENDER is poisoned → pause, don't mass-flag real buyers).
--   parcel_check_sender_healthy = the health flag; when 'false' the pending RPC
--       returns empty (verdicts paused) until the sender recovers / is swapped.
insert into public.app_settings(key, value) values
  ('parcel_check_sender_phone', '0979593026'),
  ('parcel_check_probe_buyer',  '0919342192'),
  ('parcel_check_sender_healthy', 'true')
on conflict (key) do nothing;

-- Phone is no longer required per seller (the fixed sender is used for checks) —
-- GM is the only required config field. Existing rows keep their phone; new
-- GM-only configs are allowed.
alter table public.seller_myship_config alter column ord_mobile drop not null;

-- ── 4. PENDING RPC — cache-first, then FAIR round-robin across sellers ──
create or replace function public.admin_parcel_checks_pending(p_limit int default 5)
returns table(
  id uuid, phone text, store_id text, customer_name text,
  gm_id text, sender_phone text, need_phone boolean, need_store boolean,
  queue_depth bigint, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_enabled text;
  v_healthy text;
  v_sender  text;
  -- TUNABLE: how long an 'ok' phone verdict stays reusable from the cache.
  -- Short (4h) so a buyer newly restricted since morning is re-checked before
  -- ship, while same-session repeats (< window) still hit the cache. Dated
  -- 'restricted' uses its real date; undated 'restricted' is never applied.
  v_ok_ttl constant interval := interval '4 hours';
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then
    return; -- kill switch OFF → empty set, extension idles harmlessly
  end if;
  -- SENDER HEALTH GATE: if the shared clean sender is poisoned (health-check
  -- flipped it 'false'), pause the whole lane — an empty set means zero checks,
  -- zero verdict writes → NO real buyer is mass-flagged by a bad sender.
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then
    return;
  end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  -- A blank sender (admin cleared it mid-swap) must PAUSE too — never serve rows
  -- with a null ordMobile (that would checkout-validate with an empty sender and
  -- risk a false 'ok'). Treat missing sender as paused (audit MEDIUM).
  if coalesce(v_sender, '') = '' then
    return;
  end if;

  -- CACHE APPLICATION (the single biggest load reducer): repeat buyers get
  -- their phone verdict straight from the cache — the row may then need only
  -- the store half, or nothing at all. Freshness: restricted → valid until the
  -- 7-11-asserted restricted_until (Taipei date); ok → v_ok_ttl (4h). 'unknown'
  -- is never cached (fail-safe discipline), so it can never be applied.
  update parcel_scans ps
     set phone_check_status     = c.status,
         phone_check_message    = c.message,
         phone_restricted_until = c.restricted_until,
         phone_check_at         = now()
    from phone_check_cache c
   where ps.phone_check_status is null
     and ps.status <> 'exported'
     and ps.phone = c.phone
     and (
           (c.status = 'restricted' and c.restricted_until is not null
             and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)
        or (c.status = 'ok' and c.checked_at > now() - v_ok_ttl)
         );

  -- FAIR SELECTION: row_number per seller by AGE, ordered rank-first → each
  -- batch interleaves sellers' OLDEST rows (a 2,000-parcel encoder gets one
  -- slot per round, never the whole lane). The config INNER JOIN is the
  -- attribution rule: no config → the row is structurally unreachable.
  return query
  with pending as (
    select ps.id, ps.phone, ps.store_id, ps.customer_name,
           cfg.gm_id,
           (ps.phone_check_status is null) as need_phone,
           (ps.store_full_status  is null) as need_store,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join seller_myship_config cfg
        on cfg.user_id = ps.user_id
       and coalesce(cfg.gm_id, '') <> ''  -- GM is the only required config field now
     where ps.status <> 'exported'
       and (ps.store_full_status is null or ps.phone_check_status is null)
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store,
         (select count(*) from pending) as queue_depth, p.created_at
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $$;

-- ── 5. VERDICT RPC — per-half writes (NULL = "this half was skipped, do not
--      touch it" — a cache-satisfied phone verdict is never clobbered) +
--      cache upsert for real phone verdicts. ──
create or replace function public.admin_parcel_check_verdict(
  p_id uuid,
  p_store_full_status text default null,
  p_phone_check_status text default null,
  p_phone_check_message text default null,
  p_phone_restricted_until date default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_store_full_status is not null and p_store_full_status not in ('open','full','unknown') then
    raise exception 'bad_store_status';
  end if;
  if p_phone_check_status is not null and p_phone_check_status not in ('ok','restricted','unknown') then
    raise exception 'bad_phone_status';
  end if;

  update parcel_scans set
    store_full_status      = coalesce(p_store_full_status, store_full_status),
    store_full_at          = case when p_store_full_status  is not null then now() else store_full_at  end,
    phone_check_status     = coalesce(p_phone_check_status, phone_check_status),
    phone_check_at         = case when p_phone_check_status is not null then now() else phone_check_at end,
    phone_check_message    = case when p_phone_check_status is not null then p_phone_check_message    else phone_check_message    end,
    phone_restricted_until = case when p_phone_check_status is not null then p_phone_restricted_until else phone_restricted_until end
  where id = p_id;

  -- cache only REAL phone verdicts ('unknown' never enters the cache)
  if p_phone_check_status in ('ok','restricted') then
    insert into phone_check_cache(phone, status, message, restricted_until, checked_at)
    select ps.phone, p_phone_check_status, p_phone_check_message, p_phone_restricted_until, now()
      from parcel_scans ps
     where ps.id = p_id and coalesce(ps.phone, '') <> ''
    on conflict (phone) do update
      set status = excluded.status, message = excluded.message,
          restricted_until = excluded.restricted_until, checked_at = excluded.checked_at;
  end if;
end $$;

-- ── 6. STATS RPC — admin queue visibility (queue depth + oldest-pending age =
--      the saturation tripwire; awaiting_setup = rows skipped for missing
--      config). One call per Admin-panel open, zero poll. ──
create or replace function public.admin_parcel_check_stats()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'enabled', coalesce((select s.value from app_settings s where s.key = 'parcel_check_multi_enabled'), 'false'),
    'queue_depth', (
      select count(*) from parcel_scans ps
        join seller_myship_config cfg on cfg.user_id = ps.user_id
         and coalesce(cfg.gm_id,'') <> ''
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)),
    'oldest_pending_min', (
      select coalesce(floor(extract(epoch from (now() - min(ps.created_at))) / 60), 0) from parcel_scans ps
        join seller_myship_config cfg on cfg.user_id = ps.user_id
         and coalesce(cfg.gm_id,'') <> ''
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)),
    'awaiting_setup', (
      select count(*) from parcel_scans ps
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)
         and not exists (
           select 1 from seller_myship_config cfg
            where cfg.user_id = ps.user_id
              and coalesce(cfg.gm_id,'') <> '')),  -- GM-only eligibility now
    'cache_size', (select count(*) from phone_check_cache),
    'sender_phone', (select value from app_settings where key = 'parcel_check_sender_phone'),
    'sender_healthy', coalesce((select value from app_settings where key = 'parcel_check_sender_healthy'), 'true'),
    'top_sellers', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select sp.email, count(*) as pending
          from parcel_scans ps
          join seller_profiles sp on sp.auth_user_id = ps.user_id
         where ps.status <> 'exported'
           and (ps.store_full_status is null or ps.phone_check_status is null)
         group by sp.email order by count(*) desc limit 5) t)
  ) into v;
  return v;
end $$;

-- ── 7. SENDER CONFIG + HEALTH (CHECK_SENDER_PHONE design) ──
-- Config for the extension's sender health-check. NOT gated on the health flag
-- (it must work WHILE paused so the sender can recover / be swapped). sample_gm
-- = any configured GM, needed to mint an anonymous token for the probe.
create or replace function public.admin_parcel_check_config()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'enabled', coalesce((select value from app_settings where key = 'parcel_check_multi_enabled'), 'false'),
    'healthy', coalesce((select value from app_settings where key = 'parcel_check_sender_healthy'), 'true'),
    'sender_phone', (select value from app_settings where key = 'parcel_check_sender_phone'),
    'probe_buyer',  (select value from app_settings where key = 'parcel_check_probe_buyer'),
    'sample_gm', (select gm_id from seller_myship_config where coalesce(gm_id,'') <> '' order by updated_at desc limit 1)
  ) into v;
  return v;
end $$;

-- The health-check flips this: false = sender poisoned → pending RPC pauses.
create or replace function public.admin_set_parcel_sender_health(p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into app_settings(key, value) values
    ('parcel_check_sender_healthy', case when p_ok then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value;
end $$;

-- SATURATION NOTES (design record — see the 2026-09-27 plan):
--   One extension lane ≈ 700–1,100 checks/hour while Chrome is open; honest
--   planning ceiling ≈ 4,000/day. The cache removes the repeat-buyer share of
--   phone checks (40–70% in live selling). Tripwire = oldest_pending_min
--   trending up while queue_depth grows. Phase-2 relief valve = Render port of
--   the PHONE check (SHOPMORE cookie-jar pattern; shadow-first from Render's
--   IP), NOT multi-tab parallelism — assessed and rejected: same IP/session as
--   single-tab concurrency, 3× burstier bot signature against real checkout
--   infra, correlated total-outage failure mode.
--
-- ROLLBACK: drop function admin_parcel_check_stats(); drop function
-- admin_parcel_check_verdict(uuid,text,text,text,date); drop function
-- admin_parcel_checks_pending(int); drop table phone_check_cache; drop table
-- seller_myship_config; delete from app_settings where key='parcel_check_multi_enabled';
