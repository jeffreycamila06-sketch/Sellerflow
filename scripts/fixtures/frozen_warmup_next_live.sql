-- admin_frozen_warmup_next as LIVE on production (read 2026-11-17, read only; md5 of the source
-- f3997ad30aa89c0d4d9e7daa41ee3d7f). NOT changed by sql/178; used by scripts/sql178-behaviour.mjs only.
CREATE OR REPLACE FUNCTION public.admin_frozen_warmup_next(p_limit integer DEFAULT 1)
 RETURNS TABLE(store_id text, frozen_history boolean, parcels bigint, left_count bigint, checked_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_no_ttl      constant interval := interval '30 days';
  v_ok_ttl      constant interval := interval '7 days';
  v_floor       constant interval := interval '10 minutes';
  v_unknown_gap constant interval := interval '7 days';
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
end $function$;
