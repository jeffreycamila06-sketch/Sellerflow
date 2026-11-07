-- Rollback for sql/143_admin_user_country.sql. Drops the admin-only country labels
-- (the seller market column seller_profiles.country is NOT touched).
drop table if exists public.admin_user_country;
