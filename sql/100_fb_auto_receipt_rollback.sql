-- ============================================================================
-- sql/100 ROLLBACK — removes the automatic receipt. Run only with fb_auto_receipt_enabled off
-- (the server's job insert and claim name these objects; with them gone it does nothing).
-- Receipts already sent stay in fb_receipts.
-- ============================================================================
delete from public.app_settings where key = 'fb_auto_receipt_enabled';
alter table public.seller_receipt_settings drop constraint seller_receipt_settings_auto_cur_len;
alter table public.seller_receipt_settings drop constraint seller_receipt_settings_auto_lang_len;
alter table public.seller_receipt_settings drop column auto_receipt_currency;
alter table public.seller_receipt_settings drop column auto_receipt_lang;
alter table public.seller_receipt_settings drop column auto_receipt_enabled;
drop function public.claim_auto_receipt_jobs(int);
drop table public.fb_auto_receipt_jobs;
