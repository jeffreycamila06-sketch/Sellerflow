-- ⚠️ REVERT THE WEB DEPLOY FIRST, then run this (the deployed app selects contact_platform).
-- Rollback of 140 — removes the buyer-contact platform (the saved platforms are LOST; the
-- contact values in notes / buyer_username are untouched), restores the sql/36 and sql/121
-- phonebook triggers byte-for-byte, deletes the switch and takes 'buyer_contact' out of
-- my_feature_access() (⚠️ rebuild from the LIVE definition here too — keep every other key
-- the live function has, e.g. 'tiktok_api' from sql/138).
begin;
set local lock_timeout = '5s';

-- 7-11 phonebook trigger = sql/36:44-88
create or replace function public.upsert_parcel_customer()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_name  text := nullif(trim(coalesce(new.customer_name, '')), '');
begin
  if v_phone = '' then
    return new;
  end if;

  -- Rule 2: restricted verdict arrived → remove this buyer from the phonebook.
  if new.phone_check_status = 'restricted' then
    delete from public.parcel_customers
     where user_id = new.user_id
       and phone = v_phone
       and lower(trim(coalesce(name, ''))) = lower(trim(coalesce(v_name, '')));
    return new;
  end if;

  -- Rule 1: explicit non-valid store check → do not add.
  if new.store_check_status is not null
     and new.store_check_status not in ('valid', 'unchecked', 'unknown') then
    return new;
  end if;

  insert into public.parcel_customers (user_id, phone, name, store_id, notes, updated_at)
  values (
    new.user_id,
    v_phone,
    v_name,
    nullif(trim(coalesce(new.store_id,'')), ''),
    nullif(trim(coalesce(new.notes,'')), ''),
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id   = coalesce(excluded.store_id, parcel_customers.store_id),
        notes      = coalesce(excluded.notes,    parcel_customers.notes),
        updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_upsert_parcel_customer on public.parcel_scans;
create trigger trg_upsert_parcel_customer
  after insert or update of customer_name, phone, store_id, notes, store_check_status, phone_check_status
  on public.parcel_scans
  for each row execute function public.upsert_parcel_customer();

-- FamilyMart phonebook trigger = sql/121:51-85
create or replace function public.upsert_fm_parcel_customer()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
begin
  if v_phone = '' then
    return new;
  end if;
  insert into public.fm_parcel_customers (user_id, phone, name, store_id, buyer_username, updated_at)
  values (
    new.user_id,
    v_phone,
    nullif(trim(coalesce(new.recipient_name, '')), ''),
    nullif(trim(coalesce(new.store_id, '')), ''),
    nullif(trim(coalesce(new.buyer_username, '')), ''),
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id       = coalesce(excluded.store_id, fm_parcel_customers.store_id),
        buyer_username = coalesce(excluded.buyer_username, fm_parcel_customers.buyer_username),
        updated_at     = now();
  return new;
end;
$function$;
revoke all on function public.upsert_fm_parcel_customer() from public, anon, authenticated;

drop trigger if exists trg_upsert_fm_parcel_customer on public.fm_parcel_scans;
create trigger trg_upsert_fm_parcel_customer
  after insert or update of recipient_name, phone, store_id, buyer_username
  on public.fm_parcel_scans
  for each row execute function public.upsert_fm_parcel_customer();

alter table public.parcel_scans        drop column if exists contact_platform;
alter table public.parcel_customers    drop column if exists contact_platform;
alter table public.fm_parcel_scans     drop column if exists contact_platform;
alter table public.fm_parcel_customers drop column if exists contact_platform;

delete from public.app_settings where key = 'buyer_contact_enabled';

-- the 16 FAQ rows seeded by sql/140 §6 (by exact question AND the seed's shape — a separate
-- approved row with the same question, or one made from a chat, is never ours)
delete from public.support_faq where guide_sections = array['parcel-scan','pickup-status']::text[] and from_chat_id is null and question in (
  'How do I save a buyer''s WhatsApp, LINE, Facebook or Instagram for a parcel?',
  'How do I remind a buyer to pick up a parcel?',
  'Paano i-save ang WhatsApp, LINE, Facebook o Instagram ng buyer para sa parcel?',
  'Paano paalalahanan ang buyer na kunin ang parcel?',
  '怎么为包裹保存买家的 WhatsApp、LINE、Facebook 或 Instagram？',
  '怎么提醒买家取件？',
  '怎麼為包裹儲存買家的 WhatsApp、LINE、Facebook 或 Instagram？',
  '怎麼提醒買家取件？',
  'Làm sao lưu WhatsApp, LINE, Facebook hoặc Instagram của người mua cho kiện hàng?',
  'Làm sao nhắc người mua nhận kiện hàng?',
  'บันทึก WhatsApp, LINE, Facebook หรือ Instagram ของผู้ซื้อสำหรับพัสดุอย่างไร?',
  'เตือนผู้ซื้อให้มารับพัสดุอย่างไร?',
  'Bagaimana menyimpan WhatsApp, LINE, Facebook, atau Instagram pembeli untuk paket?',
  'Bagaimana mengingatkan pembeli mengambil paket?',
  'Как да запазя WhatsApp, LINE, Facebook или Instagram на купувача за пратка?',
  'Как да напомня на купувача да вземе пратката?'
);

-- my_feature_access() without 'buyer_contact' = sql/137's list (rebuild from the live definition)
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

commit;
