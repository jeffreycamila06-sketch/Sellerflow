-- Rollback for sql/117: my_feature_access() back to the sql/116 key list, and the
-- 'parcel_cap_70' rows removed (that seller goes back to 40).
delete from public.feature_access_emails where feature = 'parcel_cap_70';

create or replace function public.my_feature_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$$;
