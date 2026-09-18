-- 39_parcel_tracking_link.sql
-- Parcel tracking — RELAX + HARDEN the buyer-username link trigger.
-- Repo MIRROR of what is applied to prod via Supabase MCP — do NOT re-apply.
-- ADDITIVE ONLY (adds one nullable column + replaces the trigger function; the
-- four own-scoped RLS policies from sql/37 already cover the new column).
--
-- WHY: the myship order-list column that the scraper reads shows only the store
-- NAME, never the 6-digit store CODE that shipping_entries.store_id carries — so
-- the sql/37 key (recipient_name + store_id + order_amount) could never fire.
-- The relaxed key drops store_id and adds a 14-day recency window instead.
--
-- ⚠️ STRICT AMBIGUITY RULE (load-bearing — Jeff's orders often repeat the same
-- amount across cheap items, so name+amount collisions are COMMON):
--   • EXACTLY ONE recent match (name + amount, se.created_at within 14 days,
--     own-scoped user_id) → fill shipping_entry_id + buyer_username.
--   • ZERO or 2+ matches → leave BOTH NULL. Never guess. A wrong buyer_username
--     makes Jeff chase the WRONG buyer — strictly worse than "no username".
--     With many same-amount orders, NULL is EXPECTED and is the CORRECT outcome.
--   • cm_order_no is metadata only, NEVER a match key.
--
-- OPTIONAL PHONE TIE-BREAKER: parcel_tracking gains a nullable recipient_phone.
-- The order-list scraper does NOT capture phone today, so it is normally NULL and
-- the strict rule above governs. IF a phone is ever supplied AND 2+ rows match on
-- name+amount+14d, we break the tie ONLY when EXACTLY ONE of them also matches the
-- phone (digits-only equality); anything else still leaves both NULL. A masked
-- phone (e.g. 0912***678) will not digit-match a full number → falls through to
-- NULL, the safe direction (never a wrong link).
--
-- SECURITY INVOKER (never DEFINER — no RLS-bypass surface) + pinned search_path,
-- unchanged from sql/37. Every read is filtered by an EXPLICIT se.user_id =
-- new.user_id so it stays correct even when the poller writes as service role.

-- Optional tie-breaker input from the scraper (normally NULL).
alter table public.parcel_tracking add column if not exists recipient_phone text null;

create or replace function public.link_parcel_tracking()
  returns trigger
  language plpgsql
  security invoker
  set search_path to 'public'
as $function$
declare
  v_entry     record;
  v_count     integer;
  v_phone_cnt integer;
  v_phone     text;
begin
  if new.shipping_entry_id is null
     and new.order_amount is not null
     and new.recipient_name is not null and trim(new.recipient_name) <> '' then

    -- How many of MY shipping_entries match name + amount within the last 14 days?
    select count(*)
      into v_count
      from public.shipping_entries se
     where se.user_id = new.user_id
       and se.order_amount = new.order_amount
       and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
       and se.created_at >= now() - interval '14 days';

    if v_count = 1 then
      -- Unambiguous: exactly one recent match → link it.
      select se.id as id, se.buyer_username as buyer_username
        into v_entry
        from public.shipping_entries se
       where se.user_id = new.user_id
         and se.order_amount = new.order_amount
         and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
         and se.created_at >= now() - interval '14 days'
       limit 1;
      new.shipping_entry_id := v_entry.id;
      new.buyer_username := coalesce(new.buyer_username, v_entry.buyer_username);

    elsif v_count >= 2 and new.recipient_phone is not null
          and regexp_replace(new.recipient_phone, '\D', '', 'g') <> '' then
      -- Ambiguous on name+amount. Try the phone tie-breaker: link ONLY when exactly
      -- one of the same-name+amount+14d rows ALSO matches the phone (digits-only).
      v_phone := regexp_replace(new.recipient_phone, '\D', '', 'g');
      select count(*)
        into v_phone_cnt
        from public.shipping_entries se
       where se.user_id = new.user_id
         and se.order_amount = new.order_amount
         and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
         and se.created_at >= now() - interval '14 days'
         and se.phone is not null
         and regexp_replace(se.phone, '\D', '', 'g') = v_phone;
      if v_phone_cnt = 1 then
        select se.id as id, se.buyer_username as buyer_username
          into v_entry
          from public.shipping_entries se
         where se.user_id = new.user_id
           and se.order_amount = new.order_amount
           and lower(trim(coalesce(se.recipient_name, ''))) = lower(trim(new.recipient_name))
           and se.created_at >= now() - interval '14 days'
           and se.phone is not null
           and regexp_replace(se.phone, '\D', '', 'g') = v_phone
         limit 1;
        new.shipping_entry_id := v_entry.id;
        new.buyer_username := coalesce(new.buyer_username, v_entry.buyer_username);
      end if;
      -- else (0, or 2+ phone matches): leave both NULL — never guess.
    end if;
    -- v_count = 0: no match → leave both NULL.
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_link_parcel_tracking on public.parcel_tracking;
create trigger trg_link_parcel_tracking
  before insert or update on public.parcel_tracking
  for each row execute function public.link_parcel_tracking();
