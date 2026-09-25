-- 52 — M2 (security audit 2026-09-26): trigger-revert the ADMIN-OWNED annotation
-- columns a seller could previously self-write.
-- Mirror of the Supabase MCP migration seller_profiles_admin_columns_revert.
--
-- THE HOLE: sql/16 grants column UPDATE on admin_contact_note + trial_started_at to
-- `authenticated` (deliberate — ADMINS write them via plain PostgREST updates:
-- adminUpdateContactNote / adminUpdatePlan, and admins ARE the `authenticated` role;
-- see the 2026-07-23 SUPABASE HARDENING CORRECTION in CLAUDE.md). The code comments
-- claimed the seller_profiles_on_update trigger reverts them for non-admins, but the
-- LIVE trigger only reverted role/plan/plan_status/plan_expiry/auth_user_id/email —
-- so a seller could PATCH their own row and write e.g. "Paid via Wise 9/20 —
-- activate Pro" into admin_contact_note to social-engineer the admin, or set their
-- own trial_started_at.
--
-- THE FIX: add both columns to the trigger's revert list (NOT a grant drop — that
-- would break the admin panel's legit writes, per the Jul 23 lesson). A seller's
-- own profile save that echoes the unchanged values back is unaffected (revert
-- keeps the old value silently, same as the existing plan/role protection).
--
-- ROLLBACK: re-apply the previous body = this function WITHOUT the two M2 lines
-- (revert list: role, plan, plan_status, plan_expiry, auth_user_id, email only).

create or replace function public.seller_profiles_on_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    -- A seller may edit profile fields, but never these:
    new.role         := old.role;
    new.plan         := old.plan;
    new.plan_status  := old.plan_status;
    new.plan_expiry  := old.plan_expiry;
    new.auth_user_id := old.auth_user_id;
    new.email        := old.email;
    -- M2 (2026-09-26): admin-owned annotations — a seller must not be able to
    -- write their own admin note ("Paid via Wise — activate Pro") or trial date.
    new.admin_contact_note := old.admin_contact_note;
    new.trial_started_at   := old.trial_started_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
