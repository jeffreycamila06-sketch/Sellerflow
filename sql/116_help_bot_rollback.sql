-- Rollback for sql/116_help_bot.sql. Removes the help bot completely (all chats + FAQ).
-- my_feature_access() goes back to the sql/112 key list.

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
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$$;

delete from public.feature_access_emails where feature = 'support_ai_preview';
delete from public.app_settings where key in
  ('support_ai_enabled', 'support_ai_monthly_cap_usd', 'support_ai_daily_per_seller', 'support_guide_checked');

drop function public.admin_support_faq_update(bigint, text, text, boolean);
drop function public.admin_support_faq_list();
drop function public.admin_support_answer_batch(jsonb);
drop function public.admin_support_approve_batch(jsonb);
drop function public.admin_support_queue(text, integer);
drop function public.admin_support_stats();
drop function public.support_mark_recheck(text[]);
drop function public.support_usage(uuid);
drop function public.support_faq_match(text);
drop function public.support_quick_questions(text, integer);
drop function public.support_admin_answers_seen();
drop function public.support_admin_answers();
drop function public.support_rate(uuid, smallint);

alter table public.support_faq drop constraint support_faq_from_chat_fk;
drop table public.support_chats;
drop table public.support_faq;
drop function public.support_norm(text);
