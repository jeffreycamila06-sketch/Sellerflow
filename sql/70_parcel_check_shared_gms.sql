-- 70 — Parcel Check without the seller's own 賣貨便 shop link (APPLIED via MCP 2026-10-03).
-- Sellers no longer paste a shop link. Access is a DB list (parcel_check_access, like
-- parcel_tracking_access) and every phone check runs on one of the OWNER's own shops
-- (app_settings.parcel_check_shared_gms). All 11 pool shops were proven with a real
-- check on 2026-10-03 00:43–00:46 Taipei. The extension is unchanged (it uses row.gm_id).
-- ROLLBACK SWITCH: update app_settings set value='[]' where key='parcel_check_shared_gms';
--   → rows use the seller's own saved link again (only sellers who saved one are checked).

create table if not exists public.parcel_check_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled    boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.parcel_check_access enable row level security;
revoke all on public.parcel_check_access from anon, authenticated;

insert into public.parcel_check_access (user_id, note)
select sp.auth_user_id, 'seed 2026-10-03 from the app preview allowlist'
  from public.seller_profiles sp
 where sp.role = 'admin'
    or lower(sp.email) in (
      'googletest@gmail.com','googletest@sellerflowlive.com','ukaydaily1@gmail.com',
      'sanggalanglhea@gmail.com','h0kmming@yahoo.com.tw','details2ndserve@gmail.com',
      'chungmaychilleann@gmail.com','choletrada1022@gmail.com','bertongpatag@gmail.com',
      'jaszhu127@gmail.com','ganggang0958@yahoo.com','jinkyrosepenana@gmail.com',
      'karenbaltazar040789@gmail.com','basaomenchie6@gmail.com','lailinehsu@gmail.com')
on conflict (user_id) do nothing;

insert into public.app_settings (key, value)
values ('parcel_check_shared_gms',
  '["GM2609096130694","GM2610017302504","GM2609307217467","GM2610037354651","GM2610037354681","GM2610037354730","GM2610037354748","GM2610037354769","GM2610037354796","GM2610037354827","GM2610037354857"]')
on conflict (key) do nothing;

-- The app asks this to decide whether to show Parcel Check to the signed-in seller.
create or replace function public.parcel_check_can_use()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_admin()
      or exists (select 1 from public.parcel_check_access a
                  where a.user_id = auth.uid() and a.enabled);
$function$;
revoke all on function public.parcel_check_can_use() from public, anon;
grant execute on function public.parcel_check_can_use() to authenticated;

-- Worker queue: eligibility = parcel_check_access; gm_id = a pool shop that moves to the
-- next one every 20 s (a retry never stays stuck on one dead shop).
CREATE OR REPLACE FUNCTION public.admin_parcel_checks_pending(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, phone text, store_id text, customer_name text, gm_id text, sender_phone text, need_phone boolean, need_store boolean, queue_depth bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled text; v_healthy text; v_sender text;
  v_ok_ttl constant interval := interval '6 hours';
  v_store_full_ttl constant interval := interval '1 hour';
  v_store_open_ttl constant interval := interval '10 minutes';
  v_store_fixed_ttl constant interval := interval '24 hours';
  v_pool text[] := '{}';
  v_n integer := 0;
  v_bucket bigint := floor(extract(epoch from clock_timestamp()) / 20)::bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select s.value into v_enabled from app_settings s where s.key = 'parcel_check_multi_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then return; end if;
  select s.value into v_healthy from app_settings s where s.key = 'parcel_check_sender_healthy';
  if coalesce(v_healthy, 'true') <> 'true' then return; end if;
  select s.value into v_sender from app_settings s where s.key = 'parcel_check_sender_phone';
  if coalesce(v_sender, '') = '' then return; end if;
  begin
    select coalesce(array_agg(t.g order by t.ord), '{}') into v_pool
      from jsonb_array_elements_text(
             (select s.value::jsonb from app_settings s where s.key = 'parcel_check_shared_gms')
           ) with ordinality as t(g, ord)
     where t.g ~ '^GM[0-9]{6,20}$';
  exception when others then
    v_pool := '{}'; -- unreadable setting → each seller's own saved link (old behaviour)
  end;
  v_n := coalesce(array_length(v_pool, 1), 0);
  update parcel_scans ps
     set phone_check_status = c.status, phone_check_message = c.message,
         phone_restricted_until = c.restricted_until, phone_check_at = now()
    from phone_check_cache c
   where ps.phone_check_status is null and ps.status <> 'exported' and ps.phone = c.phone
     and ( (c.status = 'restricted' and c.restricted_until is not null
             and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)
        or (c.status = 'ok' and c.checked_at > now() - v_ok_ttl) );
  update parcel_scans ps
     set store_full_status = c.status, store_full_at = c.checked_at
    from store_check_cache c
   where ps.status <> 'exported' and ps.store_id = c.store_id
     and ( (c.status = 'full' and c.checked_at > now() - v_store_full_ttl)
        or (c.status = 'open' and c.checked_at > now() - v_store_open_ttl)
        or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )
     and (ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at);
  return query
  with recheck as (
    select distinct on (ps.store_id) ps.id
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join store_check_cache c on c.store_id = ps.store_id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and ps.store_full_status = 'full'
       and ps.store_full_at < now() - v_store_full_ttl
       and (c.checked_at is null or c.checked_at < now() - v_store_full_ttl)
     order by ps.store_id, ps.created_at asc
  ),
  pending as (
    select ps.id, ps.phone, ps.store_id, ps.customer_name,
           case when v_n > 0
                then v_pool[1 + (((hashtext(ps.id::text)::bigint & 2147483647) + v_bucket) % v_n)::int]
                else cfg.gm_id end as gm_id,
           (ps.phone_check_status is null) as need_phone,
           (ps.store_full_status is null or r.id is not null) as need_store,
           row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank,
           ps.created_at
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
      left join seller_myship_config cfg on cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''
      left join recheck r on r.id = ps.id
     where ps.status <> 'exported'
       and (v_n > 0 or cfg.gm_id is not null)
       and (ps.store_full_status is null or ps.phone_check_status is null or r.id is not null)
  )
  select p.id, p.phone, p.store_id, p.customer_name, p.gm_id, v_sender as sender_phone,
         p.need_phone, p.need_store, (select count(*) from pending) as queue_depth, p.created_at
    from pending p
   order by p.seller_rank asc, p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 5), 25));
end $function$;

-- Sender health probe: a pool shop (a different one every 5 min); pool empty → as before.
CREATE OR REPLACE FUNCTION public.admin_parcel_check_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_pool text[] := '{}'; v_n integer := 0; v_gm text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  begin
    select coalesce(array_agg(t.g order by t.ord), '{}') into v_pool
      from jsonb_array_elements_text(
             (select s.value::jsonb from app_settings s where s.key = 'parcel_check_shared_gms')
           ) with ordinality as t(g, ord)
     where t.g ~ '^GM[0-9]{6,20}$';
  exception when others then v_pool := '{}';
  end;
  v_n := coalesce(array_length(v_pool, 1), 0);
  if v_n > 0 then
    v_gm := v_pool[1 + (floor(extract(epoch from clock_timestamp()) / 300)::bigint % v_n)::int];
  else
    select gm_id into v_gm from seller_myship_config where coalesce(gm_id,'') <> '' order by updated_at desc limit 1;
  end if;
  select jsonb_build_object(
    'enabled', coalesce((select value from app_settings where key = 'parcel_check_multi_enabled'), 'false'),
    'healthy', coalesce((select value from app_settings where key = 'parcel_check_sender_healthy'), 'true'),
    'sender_phone', (select value from app_settings where key = 'parcel_check_sender_phone'),
    'probe_buyer',  (select value from app_settings where key = 'parcel_check_probe_buyer'),
    'sample_gm', v_gm
  ) into v; return v;
end $function$;

-- Admin queue numbers follow the same eligibility. "awaiting_setup" now = parcels of
-- sellers who have NOT been given Parcel Check access.
CREATE OR REPLACE FUNCTION public.admin_parcel_check_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; w text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select s.value into w from app_settings s where s.key = 'parcel_check_worker_state';
  select jsonb_build_object(
    'enabled', coalesce((select s.value from app_settings s where s.key = 'parcel_check_multi_enabled'), 'false'),
    'queue_depth', (
      select count(*) from parcel_scans ps
        join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)),
    'oldest_pending_min', (
      select coalesce(floor(extract(epoch from (now() - min(ps.created_at))) / 60), 0) from parcel_scans ps
        join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)),
    'awaiting_setup', (
      select count(*) from parcel_scans ps
       where ps.status <> 'exported'
         and (ps.store_full_status is null or ps.phone_check_status is null)
         and not exists (
           select 1 from parcel_check_access acc
            where acc.user_id = ps.user_id and acc.enabled)),
    'cache_size', (select count(*) from phone_check_cache),
    'sender_phone', (select value from app_settings where key = 'parcel_check_sender_phone'),
    'sender_healthy', coalesce((select value from app_settings where key = 'parcel_check_sender_healthy'), 'true'),
    'worker', case when coalesce(w, '') like '{%' then w::jsonb else null end,
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
end $function$;
