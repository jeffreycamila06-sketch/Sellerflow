-- ============================================================================
-- sql/91 ROLLBACK — removes the sold-out columns. Rows already written stay (a former
-- sold-out reply row keeps blocking its comment, exactly like a receipt row would).
-- Run only with fb_soldout_enabled off (the server's sold-out claim names the kind column).
-- ============================================================================
alter table public.fb_receipts drop constraint fb_receipts_kind;
alter table public.fb_receipts drop column kind;
alter table public.seller_receipt_settings drop constraint seller_receipt_settings_soldout_len;
alter table public.seller_receipt_settings drop column soldout_text;
alter table public.seller_receipt_settings drop column soldout_enabled;
