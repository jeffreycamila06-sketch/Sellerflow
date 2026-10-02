-- 69 — Admin monitor: Parcel Scan exports per seller per day.
-- APPLIED live via MCP 2026-10-02 (do not re-run blindly; idempotent as written).
-- The counter is its own table, so it survives a seller deleting exported parcels.
-- Undo / "Put back" decrements. The trigger SWALLOWS every error — monitoring must
-- never block an export. RLS on with no policies + grants revoked: sellers cannot
-- read or write it; admins read through the is_admin()-guarded RPC.
create table if not exists public.parcel_export_daily (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,                      -- Asia/Taipei day of the export
  parcels    integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.parcel_export_daily enable row level security;
revoke all on public.parcel_export_daily from anon, authenticated;

create or replace function public.parcel_scans_count_export()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_day date;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'exported' then
        v_day := (coalesce(new.exported_at, now()) at time zone 'Asia/Taipei')::date;
        insert into public.parcel_export_daily as d (user_id, day, parcels)
        values (new.user_id, v_day, 1)
        on conflict (user_id, day) do update set parcels = d.parcels + 1, updated_at = now();
      end if;
    elsif new.status = 'exported' and old.status is distinct from 'exported' then
      v_day := (coalesce(new.exported_at, now()) at time zone 'Asia/Taipei')::date;
      insert into public.parcel_export_daily as d (user_id, day, parcels)
      values (new.user_id, v_day, 1)
      on conflict (user_id, day) do update set parcels = d.parcels + 1, updated_at = now();
    elsif old.status = 'exported' and new.status is distinct from 'exported' then
      v_day := (coalesce(old.exported_at, now()) at time zone 'Asia/Taipei')::date;
      update public.parcel_export_daily
         set parcels = greatest(parcels - 1, 0), updated_at = now()
       where user_id = old.user_id and day = v_day;
    end if;
  exception when others then
    null; -- never block the seller's export / undo
  end;
  return null;
end $function$;

drop trigger if exists trg_parcel_scans_count_export_upd on public.parcel_scans;
create trigger trg_parcel_scans_count_export_upd
  after update of status on public.parcel_scans
  for each row execute function public.parcel_scans_count_export();
drop trigger if exists trg_parcel_scans_count_export_ins on public.parcel_scans;
create trigger trg_parcel_scans_count_export_ins
  after insert on public.parcel_scans
  for each row when (new.status = 'exported')
  execute function public.parcel_scans_count_export();

-- One-time seed (2,761 parcels / 23 sellers on 2026-10-02). Pre-2026-09-24 rows have
-- no exported_at stamp → updated_at is the best available day.
insert into public.parcel_export_daily (user_id, day, parcels)
select s.user_id, (coalesce(s.exported_at, s.updated_at) at time zone 'Asia/Taipei')::date, count(*)::int
  from public.parcel_scans s
 where s.status = 'exported' and exists (select 1 from auth.users u where u.id = s.user_id)
 group by 1, 2
on conflict (user_id, day) do nothing;

create or replace function public.admin_parcel_export_monitor()
returns table (
  seller_id uuid, seller_email text, seller_store text, seller_plan text, seller_plan_status text,
  this_month integer, last_month integer, last_7d integer, today integer, total integer,
  last_export_day date, pickup_status boolean, has_shop_link boolean
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_m0    date := date_trunc('month', (now() at time zone 'Asia/Taipei'))::date;
  v_m1    date := (date_trunc('month', (now() at time zone 'Asia/Taipei')) - interval '1 month')::date;
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query
  select sp.auth_user_id, sp.email::text, sp.store_name::text, sp.plan::text, sp.plan_status::text,
         coalesce(sum(d.parcels) filter (where d.day >= v_m0), 0)::int,
         coalesce(sum(d.parcels) filter (where d.day >= v_m1 and d.day < v_m0), 0)::int,
         coalesce(sum(d.parcels) filter (where d.day > v_today - 7), 0)::int,
         coalesce(sum(d.parcels) filter (where d.day = v_today), 0)::int,
         coalesce(sum(d.parcels), 0)::int,
         max(d.day) filter (where d.parcels > 0),
         exists (select 1 from public.parcel_tracking_access a where a.user_id = sp.auth_user_id and a.enabled),
         exists (select 1 from public.seller_myship_config c where c.user_id = sp.auth_user_id and c.gm_id is not null)
    from public.parcel_export_daily d
    join public.seller_profiles sp on sp.auth_user_id = d.user_id
   group by sp.auth_user_id, sp.email, sp.store_name, sp.plan, sp.plan_status
  having coalesce(sum(d.parcels), 0) > 0
   order by 6 desc, 7 desc, 10 desc;
end $function$;
revoke all on function public.admin_parcel_export_monitor() from public, anon;
grant execute on function public.admin_parcel_export_monitor() to authenticated;
