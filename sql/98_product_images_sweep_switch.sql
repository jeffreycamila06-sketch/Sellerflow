-- ============================================================================
-- sql/98 — switch for the product-picture cleanup sweep (server.js POST
-- /admin/product-images-sweep, server/productImagesSweep.js). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Order: 96 → 97 → 98 (98 is independent; any time before the sweep is used).
-- Only the exact string 'true' turns the sweep on; anything else = off (204, nothing done).
-- An existing row is left as it is. Rollback: sql/98_product_images_sweep_switch_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('product_images_sweep_enabled', 'false')
on conflict (key) do nothing;
