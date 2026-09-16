-- 39 — AUTO CODES ON PRODUCTS: products.live_code (the seller's live/auto code).
-- ⚠️ REPO MIRROR of what is ALREADY APPLIED LIVE on production Supabase
-- (project sqeuyuktdpidmlfpqgoc) via MCP. Fetched byte-exact with pg_indexes +
-- information_schema so the repo matches prod.
--
-- Moves the Auto Mode code -> product mapping ONTO the product itself: one code =
-- one product. The auto seam now derives its AutoCode list from products with a
-- non-empty live_code (price = product.price, stock = product.stock). ADDITIVE +
-- nullable (NULL = manual-only product); production App.tsx ignores it (auto
-- orders are a redesign-only feature), so the rollback app is unaffected.
--
-- The old public.seller_auto_codes table is LEFT IN PLACE for one release
-- (rollback) — the client stops writing to it but its reads stay valid. Do NOT
-- drop it here.

-- ── Column (additive, nullable) ──────────────────────────────────────────────
alter table public.products
  add column if not exists live_code text;  -- NULL = manual-only product

-- ── One code per seller (case-insensitive, ignores blanks) ───────────────────
-- Partial unique index: enforced only for real (non-empty) codes, so the many
-- NULL/'' products never collide. Matching in the app lowercases too, so the
-- constraint and the live matcher agree.
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_user_live_code
  ON public.products USING btree (user_id, lower(live_code))
  WHERE ((live_code IS NOT NULL) AND (btrim(live_code) <> ''::text));
