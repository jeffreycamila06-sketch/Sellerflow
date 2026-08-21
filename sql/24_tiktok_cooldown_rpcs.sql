-- sql/24 — MIRROR ONLY (already applied to production via MCP; do NOT re-run).
-- The two RPCs that make the 4-hour username cooldown SERVER-authoritative. The client
-- (ManageChannels) reads cooldowns on mount using server_now (NOT the device clock) and
-- calls touch on a change; the server is the real gate — it REFUSES 'cooldown_active'.

-- Read: the caller's own slot change-times + the DB clock (server_now). A slot that has
-- never changed has NO row → not returned → the client treats it as "no cooldown".
create or replace function public.tiktok_slot_cooldowns()
  returns table(platform text, slot_index smallint, last_changed_at timestamptz, server_now timestamptz)
  language sql
  stable
as $$
  select c.platform, c.slot_index, c.last_changed_at, now() as server_now
  from public.tiktok_account_changes c
  where c.user_id = (select auth.uid());
$$;

-- Write: record a change at server now(). REFUSES with 'cooldown_active' when the slot
-- changed < 4h ago AND the caller is not an admin (is_admin()). Admins bypass. The 4h
-- window and admin bypass are enforced HERE (server), not in the client.
create or replace function public.touch_tiktok_slot(p_platform text, p_slot_index smallint)
  returns timestamptz
  language plpgsql
as $$
declare
  uid uuid := (select auth.uid());
  prev timestamptz;
  is_admin_caller boolean := public.is_admin();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_platform not in ('tiktok','facebook') then raise exception 'bad_platform'; end if;
  if p_slot_index < 0 then raise exception 'bad_slot'; end if;

  select last_changed_at into prev
  from public.tiktok_account_changes
  where user_id = uid and platform = p_platform and slot_index = p_slot_index;

  if prev is not null and not is_admin_caller and (now() - prev) < interval '4 hours' then
    raise exception 'cooldown_active';
  end if;

  insert into public.tiktok_account_changes (user_id, platform, slot_index, last_changed_at)
  values (uid, p_platform, p_slot_index, now())
  on conflict (user_id, platform, slot_index)
  do update set last_changed_at = now();

  return now();
end;
$$;
