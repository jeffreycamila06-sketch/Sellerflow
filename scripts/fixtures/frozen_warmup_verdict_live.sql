-- admin_frozen_warmup_verdict as LIVE on production (read 2026-11-21, read only). The repo's sql/145 holds an
-- older text. NOT changed by sql/193; loaded by scripts/sql193-behaviour.mjs only, which checks
-- md5(prosrc) = 67e9338b1dc4a039f81e60ba8dad9213 and md5(pg_get_functiondef) = 39b4f3353d1b60e36d8f60294d624df9.
CREATE OR REPLACE FUNCTION public.admin_frozen_warmup_verdict(p_store text, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if coalesce(p_store, '') !~ '^[0-9]{6}$' then raise exception 'bad_store'; end if;
  if p_status is null or p_status not in ('ok','no_frozen','unknown') then raise exception 'bad_status'; end if;
  if p_status in ('ok','no_frozen') then
    insert into store_frozen_cache (store_id, status, checked_at) values (p_store, p_status, now())
    on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at
      where store_frozen_cache.checked_at < excluded.checked_at;
  end if;
  insert into store_frozen_check_log (store_id, status, source) values (p_store, p_status, 'warmup');
end $function$;
