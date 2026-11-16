-- Rollback of sql/165 (invite codes + referral reward). Drops the trigger, the functions and the
-- six tables (every code, link and reward-month setting is lost). Days ALREADY added to an
-- inviter's plan_expiry stay — revoke them first (admin_referral_revoke) if they must go.
set lock_timeout = '2s';
begin;
drop trigger if exists trg_seller_profiles_zzzz_referral_reward on public.seller_profiles;
drop function if exists public.referral_reward_trg();
drop trigger if exists trg_referral_codes_retire on public.referral_codes;
drop function if exists public.referral_code_retire_trg();
drop function if exists public.admin_invite_reward_months_set(date, int);
drop function if exists public.admin_invite_reward_months_get();
drop function if exists public.admin_set_invite_code(uuid, text);
drop function if exists public.admin_referral_revoke(uuid);
drop function if exists public.admin_referrals_list(int, int, text);
drop function if exists public.admin_referral_overview();
drop function if exists public.admin_referral_preview(uuid);
drop function if exists public.referral_preview_for(uuid);
drop function if exists public.my_referral_summary();
drop function if exists public.claim_referral(text, text);
drop function if exists public.set_my_invite_code(text);
drop function if exists public.invite_code_available(text);
drop function if exists public.check_invite_code(text);
drop function if exists public.referral_mask_email(text);
drop function if exists public.referral_random_code();
drop function if exists public.referral_code_problem(text, uuid);
drop function if exists public.referral_is_reserved(text);
drop function if exists public.referral_ever_paid(uuid);
drop function if exists public.referral_email_of(uuid);
drop function if exists public.referral_taipei_month(timestamptz);
drop function if exists public.referral_is_paid_active(text, text, timestamptz);
drop function if exists public.referral_norm_code(text);
drop table if exists public.referral_paid_seen;
drop table if exists public.invite_reward_months;
drop table if exists public.referrals;
drop table if exists public.referral_reserved_codes;
drop table if exists public.referral_code_retired;
drop table if exists public.referral_codes;
commit;
