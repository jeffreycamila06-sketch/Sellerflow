-- Rollback of sql/225 (Invoicing → Facebook "Send all in Messenger"). Removes exactly what sql/225
-- added: the claim function, the jobs table (with its indexes) and the switch row. Messenger
-- receipts that were sent stay in fb_receipts (that table is not touched).
begin;
drop function if exists public.claim_fb_send_all_jobs(int);
drop table if exists public.fb_send_all_jobs;
delete from public.app_settings where key = 'fb_send_all_enabled';
commit;
