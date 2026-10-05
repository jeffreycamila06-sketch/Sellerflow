-- 80 — fb_receipts.error_detail: Facebook's own error text for a failed Messenger receipt
-- (message | type | error_user_title | error_user_msg, max 300 chars; built in
-- server/fbReceipt.js receiptErrorDetail — never the request / image URL, token, comment text or
-- commenter). NOT APPLIED by Claude Code — chat-Claude applies it. Additive, idempotent. Until it
-- is applied the server retries the failed-row update without error_detail (today's update).
alter table public.fb_receipts add column if not exists error_detail text;
