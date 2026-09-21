-- 45_seller_profiles_country.sql — market attribute for the PH/TW split.
-- Repo MIRROR of what is applied to prod via Supabase MCP.
--
-- ADDITIVE, nullable, NO default, NO backfill. NULL ≡ "treat as TW / unchanged", so
-- every existing seller's behaviour is byte-identical. ISO-2 (or NULL) enforced by a
-- CHECK. Written by the client at signup (createMyProfile INSERT) and corrected by an
-- admin (upsertUser UPDATE). Supabase-only; no Render.
alter table public.seller_profiles
  add column if not exists country text
  check (country is null or country ~ '^[A-Z]{2}$');

-- seller_profiles uses COLUMN-LEVEL grants (every editable column carries its own
-- UPDATE); a new column does NOT inherit UPDATE, so grant it explicitly — else the
-- admin override / self-save round-trip (upsertUser UPDATE incl. country) errors with
-- "permission denied for column country". INSERT/SELECT are already present for a new
-- column. RLS still row-scopes writes (auth.uid() / is_admin()); the on_update trigger
-- does NOT protect country (it protects role/plan/expiry/email), so admin + owner can
-- set it, a non-admin only on their own row.
grant update (country) on public.seller_profiles to authenticated;

-- Verify: select column_name, privilege_type from information_schema.column_privileges
--         where table_name='seller_profiles' and column_name='country' and grantee='authenticated';
--         -> INSERT, SELECT, UPDATE (+ REFERENCES)
