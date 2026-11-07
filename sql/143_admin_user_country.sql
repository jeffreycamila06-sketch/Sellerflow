-- Admin-only country label per user (Admin lists: flag + country name).
-- NOT APPLIED — apply by hand (Supabase SQL editor / MCP). Rollback: sql/143_admin_user_country_rollback.sql.
--
-- WHY A SEPARATE TABLE: seller_profiles.country decides the seller's MARKET (currency,
-- TW-only tools, "View as market" — src/redesign/adapters/market.ts). The admin's pick here
-- is a LABEL for the Admin screens only and must never change a seller's market, so it
-- lives in its own table that the seller app never reads.
--
-- Order shown in Admin: this pick > seller_profiles.country > phone-shape guess > unknown.
-- No row = automatic. Clearing = delete the row.
-- Admin only: RLS policies all use public.is_admin() (SECURITY DEFINER, already in prod).
-- Sellers cannot read or write any row (no policy matches them).

create table public.admin_user_country (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  country    text not null check (country ~ '^[A-Z]{2}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.admin_user_country enable row level security;

revoke all on public.admin_user_country from anon;
revoke all on public.admin_user_country from authenticated;
grant select, insert, update, delete on public.admin_user_country to authenticated;

create policy auc_admin_select on public.admin_user_country
  for select to authenticated using ((select public.is_admin()));
create policy auc_admin_insert on public.admin_user_country
  for insert to authenticated with check ((select public.is_admin()));
create policy auc_admin_update on public.admin_user_country
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy auc_admin_delete on public.admin_user_country
  for delete to authenticated using ((select public.is_admin()));
