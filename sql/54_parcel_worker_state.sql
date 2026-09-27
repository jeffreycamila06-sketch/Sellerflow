-- 54 — PARCEL CHECKER WORKER STATE MIRROR (extension 1.14.0, Admin card)
-- The Chrome-extension worker pushes a compact per-tab status blob (sfl / myship /
-- emap state, emap domain, last verdict times, queue depth, version, boot time)
-- into app_settings so the Admin "Store/phone check queue" card can show tab
-- health without opening the laptop. DISPLAY-ONLY: nothing reads this to gate a
-- check. Admin-gated (is_admin()) on both the write and the read.

insert into public.app_settings(key, value) values ('parcel_check_worker_state', '')
  on conflict (key) do nothing;

create or replace function public.admin_set_parcel_worker_state(p_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  insert into app_settings(key, value) values ('parcel_check_worker_state', coalesce(p_state::text, ''))
    on conflict (key) do update set value = excluded.value;
end $$;
revoke all on function public.admin_set_parcel_worker_state(jsonb) from public;
grant execute on function public.admin_set_parcel_worker_state(jsonb) to authenticated;

-- admin_parcel_check_stats() gains a 'worker' key = that blob (null when never pushed
-- or not valid JSON). Body otherwise identical to sql/53 §6.
create or replace function public.admin_parcel_check_stats()
returns jsonb
language plpgsql security definer set search_path = public as $$
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
              and coalesce(cfg.gm_id,'') <> '')),
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
end $$;

-- ROLLBACK: drop function admin_set_parcel_worker_state(jsonb); re-run sql/53 §6
-- for admin_parcel_check_stats(); delete from app_settings where key='parcel_check_worker_state';
