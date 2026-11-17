-- Rollback of sql/173: the rule check goes back to the three sql/172 words.
-- Rows already written with 'login_lost' are KEPT (they are the record of a real stop); the old
-- check is therefore added NOT VALID, so it applies to new rows only and does not fail on them.
begin;
set local lock_timeout = '2s';
alter table public.pc711_mirror_stops drop constraint if exists pc711_mirror_stops_rule_check;
alter table public.pc711_mirror_stops add constraint pc711_mirror_stops_rule_check
  check (rule in ('phone_time', 'waited', 'store_unknown')) not valid;
commit;
