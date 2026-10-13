-- Rollback of 125 — buyer_alert_lookup() back to the sql/72 definition (verbatim): only callers on
-- buyer_alert_access (or admins) get data, always the googletest@gmail.com pool; everyone else → {}.
-- Ship with BUYER_ALERT_PUBLIC = false in buyerAlert.ts.
begin;
set local lock_timeout = '5s';

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

commit;
