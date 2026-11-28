-- Rollback of sql/239: the choose-price row says "up to 9 prices" again (the checked date is left as it is).
-- Running it twice changes nothing.
begin;

update public.support_guide
   set body = replace(body, 'Under the switch, add up to 12 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 12 prices saved, remove one to add a new price.', 'Under the switch, add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.')
 where id = 'choose-price'
   and position('Under the switch, add up to 12 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 12 prices saved, remove one to add a new price.' in body) > 0;

commit;
