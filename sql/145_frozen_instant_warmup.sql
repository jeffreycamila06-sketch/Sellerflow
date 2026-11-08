-- 145_frozen_instant_warmup.sql — FROZEN (冷凍) store check: INSTANT VERDICT + WARM-UP (extension 1.18.0).
-- NOT APPLIED. chat-Claude applies via MCP after the audit. Rollback: sql/145_frozen_instant_warmup_rollback.sql.
--
-- WHY: in the Nov 5–8 trial only ~16–38% of 冷凍 parcels got a frozen verdict before export. Sellers
-- export ~6–10 s after encoding, a live E-Map check takes 10–41 s, and a store we ALREADY know
-- (store_frozen_cache) only reached a row when the extension's frozen lane called
-- admin_parcel_frozen_pending. Two fixes:
--   A. INSTANT VERDICT — a trigger puts the cached verdict on the row the moment it is saved.
--   B. WARM-UP — the leader extension pre-checks every known store (1 per minute, only when idle),
--      so most stores are in the cache before a frozen parcel ever goes there.
--
-- ORDER (lock order = the frozen lane's): the trigger on parcel_scans is created FIRST, the CHECK on
-- store_frozen_check_log is changed AFTER it. admin_parcel_frozen_verdict / _pending touch parcel_scans
-- before store_frozen_check_log, so taking the locks in the same order cannot deadlock with them.
--
-- ADD-ONLY. Everything here is NEW, with ONE exception: the CHECK on store_frozen_check_log.source is
-- widened from ('live','cache') to ('live','cache','warmup','instant') — a superset, added NOT VALID
-- (no table scan; every existing row already passes). Nothing in the dry (常溫) check is touched:
-- no existing function, trigger, policy, column or RPC changes.
--   · trigger trg_parcel_scans_frozen_instant (BEFORE INSERT OR UPDATE OF store_id, temp_layer) +
--     function parcel_scans_frozen_instant()
--   · app_settings 'frozen_warmup_enabled' = 'false' (only the exact 'true' turns warm-up on) and
--     'frozen_warmup_stop_reason' = '' (written when the extension stops warm-up by itself)
--   · admin_frozen_warmup_next(p_limit) / admin_frozen_warmup_verdict(p_store, p_status) /
--     admin_frozen_warmup_stop(p_reason) — is_admin() gated, SECURITY DEFINER (same pattern as
--     admin_parcel_frozen_pending / admin_parcel_frozen_verdict)
--
-- INSTANT VERDICT RULES (the trigger):
--   · does NOTHING unless app_settings 'frozen_store_check_enabled' = 'true' (the same switch as the
--     frozen lane; switch off = the row is saved exactly as sent, nothing cleared, nothing applied).
--   · only rows with temp_layer = '冷凍'. The cache verdict is applied only for sellers in
--     parcel_check_access (enabled) — the sellers the live frozen lane checks. NOTE: this is NARROWER
--     than admin_parcel_frozen_pending's cache step, which puts cached verdicts on 冷凍 rows of EVERY
--     seller; the trigger only does it at save time for the live-lane sellers.
--   · cache trust = the same as sql/142: 'no_frozen' ≤ 30 days, 'ok' ≤ 7 days.
--   · INSERT: frozen_store_status still NULL (and no checked_at) + a fresh cache verdict for the store
--     → the row gets that verdict + checked_at = now().
--   · UPDATE: acts ONLY when store_id or temp_layer really changes (the app sends store_id on every
--     edit, and the ⟳ Recheck never changes it → Recheck still goes live, exactly as today).
--       store_id changed → the old frozen verdict is cleared (status + checked_at NULL) FIRST, outside
--       the protected lookup (any seller — the old verdict belongs to the old store), then the new
--       store's fresh cache verdict is applied (live-lane sellers), or the row is left empty.
--       temp_layer changed to 冷凍 (same store) → the cache verdict is applied only if the row has none.
--   · exported rows are never touched (an exported parcel's verdict never changes).
--   · 'unknown' is never cached (store_frozen_cache's CHECK allows only ok / no_frozen), so it can never
--     be applied by the trigger — an unknown store stays empty for the live lane.
--   · ANY error in the lookup → the row is saved as sent (plus the clear above); the trigger never blocks
--     an insert/update.
--   · each applied verdict is logged in store_frozen_check_log with source 'instant' (best-effort).
--
-- WARM-UP RULES (admin_frozen_warmup_next):
--   · stores = parcel_customers.store_id ∪ parcel_scans.store_id, 6 digits only. Store ids only — no
--     names, no phones leave the database.
--   · a store is due when it has NO fresh cache verdict (no_frozen ≤ 30 days, ok ≤ 7 days — the sql/142
--     trust). An older verdict becomes due again by itself (that is the re-check).
--   · not handed out again: within 10 min of ANY check of it (the shared per-store floor), or within
--     7 days after a warm-up check that got no answer ('unknown').
--   · order: (1) stores that ever received a 冷凍 parcel, (2) most parcels to the store first
--     (parcel_scans rows + parcel_customers rows), (3) store id.
--   · cost: ≈ 0.7 s on live data (Nov 8; mostly the parcel_customers scan) — the extension reads 5 stores
--     at a time and at most once per 5 minutes, only while idle.
--   · returns nothing unless BOTH 'frozen_store_check_enabled' and 'frozen_warmup_enabled' are 'true'.
--
-- ⚠️ BUILD FROM LIVE DEFINITIONS at apply time. Check first that none of these exist:
--   select proname from pg_proc where proname in ('parcel_scans_frozen_instant','admin_frozen_warmup_next',
--     'admin_frozen_warmup_verdict','admin_frozen_warmup_stop');                                   -- 0 rows
--   select tgname from pg_trigger where tgname = 'trg_parcel_scans_frozen_instant';               -- 0 rows
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'store_frozen_check_log_source_check';
--     -- CHECK ((source = ANY (ARRAY['live'::text, 'cache'::text])))
-- Apply checks:
--   select value from public.app_settings where key = 'frozen_warmup_enabled';                     -- 'false'
--   select * from public.admin_frozen_warmup_next(1);                                              -- as an admin: 0 rows while off
-- Turn warm-up ON (after the review; the Mac must run extension 1.18.0):
--   update public.app_settings set value = 'true', updated_at = now() where key = 'frozen_warmup_enabled';
--   update public.app_settings set value = '', updated_at = now() where key = 'frozen_warmup_stop_reason';
-- Turn it OFF: the same update with 'false'.
begin;
set local lock_timeout = '5s';

-- ── 1. INSTANT VERDICT: the cached verdict on the row the moment it is saved ──
create or replace function public.parcel_scans_frozen_instant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_no_ttl constant interval := interval '30 days';  -- no_frozen trusted this long (= sql/142)
  v_ok_ttl constant interval := interval '7 days';   -- ok trusted this long (= sql/142)
  v_on     text;
  v_access boolean := false;
  v_apply  boolean := false;   -- look the store up in the cache
  v_status text;
begin
  -- cheap exits first (no sub-transaction): dry rows, exported rows, edits that change neither field
  if new.temp_layer is distinct from '冷凍' then return new; end if;
  if new.status is not distinct from 'exported' then return new; end if;
  if tg_op = 'UPDATE' and new.store_id is not distinct from old.store_id
     and new.temp_layer is not distinct from old.temp_layer then
    return new;
  end if;

  -- the frozen switch: anything but the exact 'true' (or a read error) = do nothing at all
  begin
    select s.value into v_on from app_settings s where s.key = 'frozen_store_check_enabled';
  exception when others then
    return new;
  end;
  if coalesce(v_on, 'false') <> 'true' then return new; end if;

  -- store changed → drop the old verdict FIRST, outside the protected lookup (a lookup error below
  -- can never leave the old store's verdict on the row)
  if tg_op = 'UPDATE' and new.store_id is distinct from old.store_id then
    new.frozen_store_status := null;
    new.frozen_store_checked_at := null;
  end if;

  begin
    select exists (select 1 from parcel_check_access a where a.user_id = new.user_id and a.enabled) into v_access;
    if not v_access then return new; end if;              -- the live frozen lane's sellers only
    v_apply := new.frozen_store_status is null and new.frozen_store_checked_at is null;
    if v_apply and coalesce(new.store_id, '') ~ '^[0-9]{6}$' then
      select c.status into v_status
        from store_frozen_cache c
       where c.store_id = new.store_id
         and ( (c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)
            or (c.status = 'ok'        and c.checked_at > now() - v_ok_ttl) );
    end if;
  exception when others then
    return new;                                             -- never block the save (the clear above stays)
  end;

  if v_status is not null then
    new.frozen_store_status := v_status;
    new.frozen_store_checked_at := now();
    begin
      insert into store_frozen_check_log (store_id, status, source) values (new.store_id, v_status, 'instant');
    exception when others then null;                        -- the log is best-effort
    end;
  end if;
  return new;
end $$;
revoke all on function public.parcel_scans_frozen_instant() from public, anon, authenticated;

drop trigger if exists trg_parcel_scans_frozen_instant on public.parcel_scans;
create trigger trg_parcel_scans_frozen_instant
  before insert or update of store_id, temp_layer on public.parcel_scans
  for each row execute function public.parcel_scans_frozen_instant();

-- ── 2. the log may name the two new sources (a superset of the old CHECK; NOT VALID = no scan) ──
alter table public.store_frozen_check_log drop constraint if exists store_frozen_check_log_source_check;
-- no OTHER check on source may survive (a differently-named one would still reject 'warmup'/'instant')
do $chk$
declare v_left text;
begin
  select string_agg(c.conname, ', ') into v_left
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'source'
   where c.conrelid = 'public.store_frozen_check_log'::regclass
     and c.contype = 'c'
     and a.attnum = any (c.conkey);
  if v_left is not null then
    raise exception 'sql/145: another CHECK on store_frozen_check_log.source still exists: % — stop and look', v_left;
  end if;
end $chk$;
alter table public.store_frozen_check_log add constraint store_frozen_check_log_source_check
  check (source in ('live','cache','warmup','instant')) not valid;

-- ── 3. the warm-up switch (seeded OFF) + the stop reason the extension writes when it stops itself ──
insert into public.app_settings (key, value) values ('frozen_warmup_enabled', 'false') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('frozen_warmup_stop_reason', '') on conflict (key) do nothing;

-- ── 4. WARM-UP: which store to pre-check next ──
create or replace function public.admin_frozen_warmup_next(p_limit integer default 1)
returns table(store_id text, frozen_history boolean, parcels bigint, left_count bigint, checked_count bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_no_ttl      constant interval := interval '30 days';   -- a no_frozen younger than this = known (= sql/142)
  v_ok_ttl      constant interval := interval '7 days';    -- an ok younger than this = known (= sql/142)
  v_floor       constant interval := interval '10 minutes'; -- ≤ 1 check per store per 10 min (all lanes)
  v_unknown_gap constant interval := interval '7 days';     -- a warm-up 'unknown' is retried after this (bad / company store ids are not re-asked daily)
  v_on text; v_warm text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_on   from app_settings s where s.key = 'frozen_store_check_enabled';
  select s.value into v_warm from app_settings s where s.key = 'frozen_warmup_enabled';
  if coalesce(v_on, 'false') <> 'true' or coalesce(v_warm, 'false') <> 'true' then return; end if;

  return query
  with used as (
    select ps.store_id as sid, count(*) as n, bool_or(ps.temp_layer = '冷凍') as fz
      from parcel_scans ps where ps.store_id ~ '^[0-9]{6}$' group by ps.store_id
    union all
    select pc.store_id, count(*), false
      from parcel_customers pc where pc.store_id ~ '^[0-9]{6}$' group by pc.store_id
  ),
  stores as (
    select u.sid, sum(u.n)::bigint as n, bool_or(u.fz) as fz from used u group by u.sid
  ),
  todo as (
    select s.sid, s.n, s.fz from stores s
     where not exists (select 1 from store_frozen_cache c
                        where c.store_id = s.sid
                          and ( (c.status = 'no_frozen' and c.checked_at > now() - v_no_ttl)
                             or (c.status = 'ok'        and c.checked_at > now() - v_ok_ttl) ))
  ),
  due as (
    select t.sid, t.n, t.fz from todo t
     where not exists (select 1 from store_frozen_check_log l
                        where l.store_id = t.sid and l.checked_at > now() - v_floor)
       and not exists (select 1 from store_frozen_check_log l
                        where l.store_id = t.sid and l.source = 'warmup' and l.status = 'unknown'
                          and l.checked_at > now() - v_unknown_gap)
  )
  select d.sid, d.fz, d.n,
         (select count(*) from todo)::bigint,
         (select count(distinct l.store_id) from store_frozen_check_log l where l.source = 'warmup')::bigint
    from due d
   order by d.fz desc, d.n desc, d.sid asc
   limit least(greatest(coalesce(p_limit, 1), 1), 5);
end $$;
revoke all on function public.admin_frozen_warmup_next(integer) from public, anon;
grant execute on function public.admin_frozen_warmup_next(integer) to authenticated;

-- ── 5. WARM-UP: one store's answer → the same cache + log (source 'warmup') ──
create or replace function public.admin_frozen_warmup_verdict(p_store text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if coalesce(p_store, '') !~ '^[0-9]{6}$' then raise exception 'bad_store'; end if;
  if p_status is null or p_status not in ('ok','no_frozen','unknown') then raise exception 'bad_status'; end if;
  if p_status in ('ok','no_frozen') then                     -- 'unknown' is never cached
    insert into store_frozen_cache (store_id, status, checked_at) values (p_store, p_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at
      where store_frozen_cache.checked_at < excluded.checked_at;
  end if;
  insert into store_frozen_check_log (store_id, status, source) values (p_store, p_status, 'warmup');
end $$;
revoke all on function public.admin_frozen_warmup_verdict(text, text) from public, anon;
grant execute on function public.admin_frozen_warmup_verdict(text, text) to authenticated;

-- ── 6. WARM-UP: the extension stops itself (captcha / block / login page / HTTP 403 / 429) ──
create or replace function public.admin_frozen_warmup_stop(p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update app_settings set value = 'false', updated_at = now() where key = 'frozen_warmup_enabled';
  insert into app_settings (key, value, updated_at) values ('frozen_warmup_stop_reason', left(coalesce(p_reason, ''), 200), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end $$;
revoke all on function public.admin_frozen_warmup_stop(text) from public, anon;
grant execute on function public.admin_frozen_warmup_stop(text) to authenticated;

commit;
