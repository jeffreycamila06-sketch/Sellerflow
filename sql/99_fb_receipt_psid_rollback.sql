-- sql/99 ROLLBACK — removes recipient_psid (the server then writes sent rows without it).
alter table public.fb_receipts drop constraint fb_receipts_recipient_psid_len;
alter table public.fb_receipts drop column recipient_psid;
