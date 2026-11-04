-- 140_buyer_contact.sql — Buyer contact platform (docs/plans/buyer-contact.md, v2).
-- NOT APPLIED. chat-Claude applies via MCP after review (the web deploy must come AFTER this:
-- the app's parcel / phonebook reads select the new column).
--
-- The platform a parcel buyer can be reached on: tiktok / line / whatsapp / facebook /
-- instagram / other. ONE new nullable column on the four parcel tables; the contact VALUE
-- stays in today's column (parcel_scans.notes = 賣貨便 col J, fm buyer_username). NULL =
-- TikTok / legacy → every existing row keeps today's behaviour; col J, the 賣貨便 export,
-- the 匯出報表 sync, the Chrome extension, the poller, Buyer Alert and the sticker QR are
-- untouched (they never read the new column).
--
-- ⚠️ my_feature_access(): sql/138 (tiktok_api) and sql/139 may be applied before or after this
-- file. At apply time, build the function from the LIVE definition
-- (select pg_get_functiondef('public.my_feature_access'::regproc)) keeping EVERY key it already
-- has + 'buyer_contact' (and 'tiktok_api' if sql/138 is applied). The version below = sql/137's
-- key list + 'buyer_contact'.
-- Apply check:  select public.my_feature_access() ? 'buyer_contact';   -- true (and ? 'tiktok_api' when 138 is applied)
--               select value from public.app_settings where key = 'buyer_contact_enabled';  -- 'false'
-- Switch on (Plus / Pro / Master, after the device test):
--   update public.app_settings set value = 'true', updated_at = now() where key = 'buyer_contact_enabled';
-- Preview before the switch: insert into public.feature_access_emails (feature, email, is_prefix) values ('buyer_contact', '<login email>', false);
-- ⚠️ The 16 FAQ rows (§6) are seeded DISABLED. WHEN the switch is flipped (not at merge): enable them +
-- apply sql/116b (the guide) in the same step, so the help bot never describes a feature sellers can't see:
--   update public.support_faq set enabled = true, approved_at = now() where 'pickup-status' = any(guide_sections) and enabled = false and question in (<the 16 questions below>);
-- ⚠️ PRE-APPLY CHECK — must return 0 rows (the §6 seed skips an existing question, so a row that is
-- already there would be left as-is AND the rollback would not know it is ours):
--   select lang, question, enabled from public.support_faq where question in (
--     'How do I save a buyer''s WhatsApp, LINE, Facebook or Instagram for a parcel?',
--     'How do I remind a buyer to pick up a parcel?',
--     'Paano i-save ang WhatsApp, LINE, Facebook o Instagram ng buyer para sa parcel?',
--     'Paano paalalahanan ang buyer na kunin ang parcel?',
--     '怎么为包裹保存买家的 WhatsApp、LINE、Facebook 或 Instagram？',
--     '怎么提醒买家取件？',
--     '怎麼為包裹儲存買家的 WhatsApp、LINE、Facebook 或 Instagram？',
--     '怎麼提醒買家取件？',
--     'Làm sao lưu WhatsApp, LINE, Facebook hoặc Instagram của người mua cho kiện hàng?',
--     'Làm sao nhắc người mua nhận kiện hàng?',
--     'บันทึก WhatsApp, LINE, Facebook หรือ Instagram ของผู้ซื้อสำหรับพัสดุอย่างไร?',
--     'เตือนผู้ซื้อให้มารับพัสดุอย่างไร?',
--     'Bagaimana menyimpan WhatsApp, LINE, Facebook, atau Instagram pembeli untuk paket?',
--     'Bagaimana mengingatkan pembeli mengambil paket?',
--     'Как да запазя WhatsApp, LINE, Facebook или Instagram на купувача за пратка?',
--     'Как да напомня на купувача да вземе пратката?'
--   );
begin;
set local lock_timeout = '5s';

-- ── 1. the column (nullable; NULL = TikTok / legacy) ───────────────────────────
alter table public.parcel_scans         add column if not exists contact_platform text check (contact_platform is null or contact_platform in ('tiktok','line','whatsapp','facebook','instagram','other'));
alter table public.parcel_customers     add column if not exists contact_platform text check (contact_platform is null or contact_platform in ('tiktok','line','whatsapp','facebook','instagram','other'));
alter table public.fm_parcel_scans      add column if not exists contact_platform text check (contact_platform is null or contact_platform in ('tiktok','line','whatsapp','facebook','instagram','other'));
alter table public.fm_parcel_customers  add column if not exists contact_platform text check (contact_platform is null or contact_platform in ('tiktok','line','whatsapp','facebook','instagram','other'));

-- ── 2. 7-11 phonebook trigger — body = sql/36:44-88 + contact_platform ──────────
-- The platform travels WITH the handle: a parcel with a handle replaces both; a parcel with a
-- blank handle keeps the saved handle AND its platform.
create or replace function public.upsert_parcel_customer()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_name  text := nullif(trim(coalesce(new.customer_name, '')), '');
  v_notes text := nullif(trim(coalesce(new.notes, '')), '');
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

  insert into public.parcel_customers (user_id, phone, name, store_id, notes, contact_platform, updated_at)
  values (
    new.user_id,
    v_phone,
    v_name,
    nullif(trim(coalesce(new.store_id,'')), ''),
    v_notes,
    case when v_notes is null then null else new.contact_platform end,
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id         = coalesce(excluded.store_id, parcel_customers.store_id),
        notes            = coalesce(excluded.notes,    parcel_customers.notes),
        contact_platform = case when excluded.notes is null then parcel_customers.contact_platform else excluded.contact_platform end,
        updated_at       = now();
  return new;
end;
$function$;

drop trigger if exists trg_upsert_parcel_customer on public.parcel_scans;
create trigger trg_upsert_parcel_customer
  after insert or update of customer_name, phone, store_id, notes, contact_platform, store_check_status, phone_check_status
  on public.parcel_scans
  for each row execute function public.upsert_parcel_customer();

-- ── 3. FamilyMart phonebook trigger — body = sql/121:51-78 + contact_platform ───
create or replace function public.upsert_fm_parcel_customer()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_phone text := trim(coalesce(new.phone, ''));
  v_user  text := nullif(trim(coalesce(new.buyer_username, '')), '');
begin
  if v_phone = '' then
    return new;
  end if;
  insert into public.fm_parcel_customers (user_id, phone, name, store_id, buyer_username, contact_platform, updated_at)
  values (
    new.user_id,
    v_phone,
    nullif(trim(coalesce(new.recipient_name, '')), ''),
    nullif(trim(coalesce(new.store_id, '')), ''),
    v_user,
    case when v_user is null then null else new.contact_platform end,
    now()
  )
  on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update
    set store_id         = coalesce(excluded.store_id, fm_parcel_customers.store_id),
        buyer_username   = coalesce(excluded.buyer_username, fm_parcel_customers.buyer_username),
        contact_platform = case when excluded.buyer_username is null then fm_parcel_customers.contact_platform else excluded.contact_platform end,
        updated_at       = now();
  return new;
end;
$function$;
revoke all on function public.upsert_fm_parcel_customer() from public, anon, authenticated;

drop trigger if exists trg_upsert_fm_parcel_customer on public.fm_parcel_scans;
create trigger trg_upsert_fm_parcel_customer
  after insert or update of recipient_name, phone, store_id, buyer_username, contact_platform
  on public.fm_parcel_scans
  for each row execute function public.upsert_fm_parcel_customer();

-- ── 4. the switch (OFF) ───────────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('buyer_contact_enabled', 'false')
on conflict (key) do nothing;

-- ── 5. the preview key — REBUILD FROM THE LIVE DEFINITION AT APPLY TIME (see header) ──
create or replace function public.my_feature_access()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview'), ('parcel_cap_70'), ('fm_pickup'), ('test_printers'), ('tiktok_send'), ('fb_post_sales'), ('buyer_contact')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$function$;

-- ── 6. help-bot FAQ (user-level words, 8 languages; the guide sections carry the detail) ──
insert into public.support_faq (lang, question, answer, guide_sections, enabled, approved_at)
select v.lang, v.question, v.answer, array['parcel-scan','pickup-status'], false, null  -- disabled until the switch flips (see header)
from (values
  ('en', 'How do I save a buyer''s WhatsApp, LINE, Facebook or Instagram for a parcel?', 'In Parcel Scan, under the amount, tap the buyer''s app (TikTok, LINE, WhatsApp, Facebook, Instagram or Other) and type the contact. The app you picked stays selected for the next parcel. Tick "Buyer has no contact" if there is none.'),
  ('en', 'How do I remind a buyer to pick up a parcel?', 'Open Pickup Status, tab "Buyer waiting for pickup". Tap the buyer''s app button: WhatsApp opens the chat with a ready reminder; LINE, Messenger and Instagram open the buyer and copy the reminder so you can paste it; Copy message copies the reminder.'),
  ('fil', 'Paano i-save ang WhatsApp, LINE, Facebook o Instagram ng buyer para sa parcel?', 'Sa Parcel Scan, sa ilalim ng amount, i-tap ang app ng buyer (TikTok, LINE, WhatsApp, Facebook, Instagram o Iba pa) at i-type ang contact. Mananatiling napili ang app para sa susunod na parcel. I-tick ang "Walang contact ang buyer" kung wala.'),
  ('fil', 'Paano paalalahanan ang buyer na kunin ang parcel?', 'Buksan ang Pickup Status, tab "Buyer waiting for pickup". I-tap ang button ng app ng buyer: binubuksan ng WhatsApp ang chat na may nakahandang paalala; binubuksan ng LINE, Messenger at Instagram ang buyer at kinokopya ang paalala para ma-paste mo; kinokopya ng Copy message ang paalala.'),
  ('zh', '怎么为包裹保存买家的 WhatsApp、LINE、Facebook 或 Instagram？', '在包裹扫描中，金额下方点选买家使用的应用（TikTok、LINE、WhatsApp、Facebook、Instagram 或其他），输入联系方式。所选应用会保留给下一个包裹。没有联系方式时勾选「买家没有联系方式」。'),
  ('zh', '怎么提醒买家取件？', '打开取货状态，切到「买家待取件」。点买家应用的按钮：WhatsApp 会打开带好提醒内容的聊天；LINE、Messenger、Instagram 会打开买家并复制提醒，直接粘贴即可；「复制消息」会复制提醒内容。'),
  ('zh-TW', '怎麼為包裹儲存買家的 WhatsApp、LINE、Facebook 或 Instagram？', '在包裹掃描中，金額下方點選買家使用的 App（TikTok、LINE、WhatsApp、Facebook、Instagram 或其他），輸入聯絡方式。所選 App 會保留給下一個包裹。沒有聯絡方式時勾選「買家沒有聯絡方式」。'),
  ('zh-TW', '怎麼提醒買家取件？', '打開取貨狀態，切到「買家待取件」。點買家 App 的按鈕：WhatsApp 會打開已帶好提醒內容的聊天；LINE、Messenger、Instagram 會打開買家並複製提醒，直接貼上即可；「複製訊息」會複製提醒內容。'),
  ('vi', 'Làm sao lưu WhatsApp, LINE, Facebook hoặc Instagram của người mua cho kiện hàng?', 'Trong Quét kiện hàng, dưới số tiền, chạm ứng dụng của người mua (TikTok, LINE, WhatsApp, Facebook, Instagram hoặc Khác) rồi nhập liên hệ. Ứng dụng đã chọn được giữ cho kiện tiếp theo. Đánh dấu "Người mua không có liên hệ" nếu không có.'),
  ('vi', 'Làm sao nhắc người mua nhận kiện hàng?', 'Mở Trạng thái nhận hàng, tab "Người mua chờ nhận". Chạm nút ứng dụng của người mua: WhatsApp mở chat với lời nhắc sẵn; LINE, Messenger, Instagram mở người mua và sao chép lời nhắc để bạn dán; Sao chép tin nhắn sao chép lời nhắc.'),
  ('th', 'บันทึก WhatsApp, LINE, Facebook หรือ Instagram ของผู้ซื้อสำหรับพัสดุอย่างไร?', 'ในสแกนพัสดุ ใต้ช่องจำนวนเงิน แตะแอปของผู้ซื้อ (TikTok, LINE, WhatsApp, Facebook, Instagram หรืออื่น ๆ) แล้วพิมพ์ช่องทางติดต่อ แอปที่เลือกจะคงไว้สำหรับพัสดุถัดไป ติ๊ก "ผู้ซื้อไม่มีช่องทางติดต่อ" ถ้าไม่มี'),
  ('th', 'เตือนผู้ซื้อให้มารับพัสดุอย่างไร?', 'เปิดสถานะการรับพัสดุ แท็บ "ผู้ซื้อรอรับ" แตะปุ่มแอปของผู้ซื้อ: WhatsApp เปิดแชตพร้อมข้อความเตือน; LINE, Messenger, Instagram เปิดผู้ซื้อและคัดลอกข้อความให้วาง; คัดลอกข้อความ คัดลอกข้อความเตือน'),
  ('id', 'Bagaimana menyimpan WhatsApp, LINE, Facebook, atau Instagram pembeli untuk paket?', 'Di Pindai Paket, di bawah jumlah, ketuk aplikasi pembeli (TikTok, LINE, WhatsApp, Facebook, Instagram, atau Lainnya) lalu ketik kontaknya. Aplikasi yang dipilih tetap untuk paket berikutnya. Centang "Pembeli tidak punya kontak" jika tidak ada.'),
  ('id', 'Bagaimana mengingatkan pembeli mengambil paket?', 'Buka Status Pengambilan, tab "Pembeli menunggu pengambilan". Ketuk tombol aplikasi pembeli: WhatsApp membuka chat dengan pengingat siap kirim; LINE, Messenger, Instagram membuka pembeli dan menyalin pengingat untuk ditempel; Salin pesan menyalin pengingat.'),
  ('bg', 'Как да запазя WhatsApp, LINE, Facebook или Instagram на купувача за пратка?', 'В Сканиране на пратки, под сумата, докоснете приложението на купувача (TikTok, LINE, WhatsApp, Facebook, Instagram или Друго) и въведете контакта. Избраното приложение остава за следващата пратка. Отбележете „Купувачът няма контакт“, ако няма.'),
  ('bg', 'Как да напомня на купувача да вземе пратката?', 'Отворете Статус на вземане, таб „Купувачът чака вземане“. Докоснете бутона на приложението на купувача: WhatsApp отваря чата с готово напомняне; LINE, Messenger и Instagram отварят купувача и копират напомнянето, за да го поставите; Копирай съобщението копира напомнянето.')
) as v(lang, question, answer)
where not exists (select 1 from public.support_faq f where f.question = v.question and f.lang is not distinct from v.lang);

commit;
