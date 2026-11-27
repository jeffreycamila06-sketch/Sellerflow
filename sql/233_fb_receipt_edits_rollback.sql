-- Rollback of sql/233: removes the saved Facebook receipt edits (the table, its check function, its trigger
-- function and its clean-up job). Send all then draws every receipt from the orders again (the server reads
-- the table only when it is there). Nothing else is touched.
begin;
set local lock_timeout = '3s';

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-old-fb-receipt-edits') then
      perform cron.unschedule('purge-old-fb-receipt-edits');
    end if;
  end if;
end $$;

drop table if exists public.fb_receipt_edits;
drop function if exists public.fb_receipt_edits_stamp();
drop function if exists public.fb_receipt_edit_lines_ok(jsonb);

commit;
