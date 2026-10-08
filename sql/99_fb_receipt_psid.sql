-- ============================================================================
-- sql/99 — fb_receipts.recipient_psid: the buyer's Page-scoped ID (PSID) that Facebook returns
-- (recipient_id) after a private reply. Kept for later messages to that buyer.
-- ============================================================================
-- NOT APPLIED. Additive, nullable, no backfill. fb_receipts stays server-only (no browser
-- grant, written by the service role). The server writes the column only when Facebook
-- returned an id; if this file is not applied yet, the server retries the update without it,
-- so sends keep working either way. Rollback: sql/99_fb_receipt_psid_rollback.sql.
-- ============================================================================
alter table public.fb_receipts add column if not exists recipient_psid text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fb_receipts_recipient_psid_len') then
    alter table public.fb_receipts add constraint fb_receipts_recipient_psid_len
      check (recipient_psid is null or char_length(recipient_psid) <= 64);
  end if;
end $$;
revoke all on public.fb_receipts from anon;
revoke all on public.fb_receipts from authenticated;
