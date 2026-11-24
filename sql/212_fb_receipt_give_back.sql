-- ============================================================================
-- sql/212 — Messenger receipts: give back the comments used up by Facebook error 10 / 2018300
--   ("another app is controlling this thread now") — ONE TIME, OPTIONAL (2026-11-24).
--
-- Why: with that error nothing was sent to the buyer, yet each failed try was counted against the
--   comment (2 failed tries = the comment is used up, and a buyer whose comments are all used up has
--   no Send button). The server fix on branch claude/fb-receipt-thread-owner stops counting these
--   failed tries — the ones already saved too — so AFTER that Render deploy this file changes nothing
--   a seller can see. Run it only to give the comments back BEFORE the deploy.
--
-- What it does: deletes the failed tries of exactly that error. Nothing else: a sent or waiting
--   receipt, and a failed try with any other error, are not touched. The deleted rows are copied to
--   fb_receipts_given_back_212 first (no browser access), so the rollback can put them back.
--   Rule only — no ids, no names.
--
-- Preview (read only, run it first; on 2026-11-24: 13 tries, 12 comments, 1 seller, 1 comment used up):
--   select count(*) as tries, count(distinct comment_id) as comments, count(distinct user_id) as sellers
--     from public.fb_receipts where status = 'failed' and error_code = '10/2018300';
--
-- NOT APPLIED. Rollback: sql/212_fb_receipt_give_back_rollback.sql
-- ============================================================================
begin;
set local lock_timeout = '2s';

create table if not exists public.fb_receipts_given_back_212 (like public.fb_receipts);
alter table public.fb_receipts_given_back_212 enable row level security;   -- no policies: no browser access
revoke all on public.fb_receipts_given_back_212 from anon, authenticated;

with gone as (
  delete from public.fb_receipts
   where status = 'failed'
     and error_code = '10/2018300'
  returning *
)
insert into public.fb_receipts_given_back_212 select * from gone;

commit;
