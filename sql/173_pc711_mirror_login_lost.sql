-- sql/173 — 7-11 server checker: mirror switches itself off when the server loses its 7-11 login
-- (rule word 'login_lost'). Jeff 2026-11-17.
--
-- The ONE change to an existing object: the rule check on pc711_mirror_stops gains the word
-- 'login_lost'. It is dropped and added again with the four words. Existing rows already hold one
-- of the old three words, so they stay valid (the new check is validated). Nothing else changes:
-- pc711_mirror_stop() is untouched and still only ever writes 'false' to pc711_mirror_enabled.
--
-- Checked live 2026-11-17 (read only): the only check on the table is
-- pc711_mirror_stops_rule_check = CHECK (rule IN ('phone_time','waited','store_unknown')).
--
-- Rollback: sql/173_pc711_mirror_login_lost_rollback.sql.
begin;
set local lock_timeout = '2s';

alter table public.pc711_mirror_stops drop constraint if exists pc711_mirror_stops_rule_check;

-- stop (the whole file rolls back) if any other check on the table survived the drop
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.pc711_mirror_stops'::regclass and contype = 'c') then
    raise exception 'sql/173: another check on pc711_mirror_stops survived — nothing changed';
  end if;
end $$;

alter table public.pc711_mirror_stops add constraint pc711_mirror_stops_rule_check
  check (rule in ('phone_time', 'waited', 'store_unknown', 'login_lost'));

commit;
