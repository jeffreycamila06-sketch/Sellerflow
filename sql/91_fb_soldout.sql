-- ============================================================================
-- sql/91 — Facebook sold-out message (F2): the seller's toggle + text, and a kind on fb_receipts.
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Additive only, nothing rewritten.
-- seller_receipt_settings (sql/74): soldout_enabled (default false = nothing is ever sent) and
--   soldout_text ('' = the built-in text in the seller's language). The table already grants
--   the owner select/insert/update and its row policies cover every column, so the new columns
--   need no new grant or policy (older app versions name their columns in the upsert and never
--   touch these).
-- fb_receipts (sql/75): kind 'receipt' (every existing row, by default) or 'soldout'. The
--   existing unique index fb_receipts_one_live_per_comment (comment_id where status <>
--   'failed') now covers BOTH kinds: one live private reply per comment, whichever kind came
--   first. fb_receipts stays server-only (no browser grant, written by the service role).
-- Rollback: sql/91_fb_soldout_rollback.sql.
-- ============================================================================

alter table public.seller_receipt_settings
  add column if not exists soldout_enabled boolean not null default false,
  add column if not exists soldout_text text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_receipt_settings_soldout_len') then
    alter table public.seller_receipt_settings
      add constraint seller_receipt_settings_soldout_len check (char_length(soldout_text) <= 500);
  end if;
end $$;

alter table public.fb_receipts
  add column if not exists kind text not null default 'receipt';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fb_receipts_kind') then
    alter table public.fb_receipts
      add constraint fb_receipts_kind check (kind in ('receipt', 'soldout'));
  end if;
end $$;

-- server-only table: browser roles keep no access (same as today)
revoke all on public.fb_receipts from anon;
revoke all on public.fb_receipts from authenticated;
