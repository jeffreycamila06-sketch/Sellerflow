-- ============================================================================
-- sql/239 — help guide, ONE row of support_guide (2026-11-28): Choose price before print, up to 12 prices.
-- Same words as docs/support/sfl-guide.md / sql/116b. A PHRASE SWAP: the update runs only where the old
-- sentence is found (live row read 2026-11-28: choose-price body md5 5038b32bf39c071897dccc9c2a3dd8ba),
-- so running it twice changes nothing the second time. No Render deploy (the help bot re-reads every 5 min).
-- NOT APPLIED. Apply AFTER the web merge and sql/238 (12 prices must work before the guide says so).
-- Rollback: sql/239_guide_choose_price_twelve_rollback.sql
-- ============================================================================
begin;

update public.support_guide
   set body = replace(body, 'Under the switch, add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.', 'Under the switch, add up to 12 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 12 prices saved, remove one to add a new price.'),
       checked = greatest(checked, '2026-11-28'::date)
 where id = 'choose-price'
   and position('Under the switch, add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.' in body) > 0;

commit;
