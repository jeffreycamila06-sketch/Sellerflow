-- ============================================================================
-- sql/202 — help guide: the word "beta" leaves the Shopee text sellers read (2026-11-22).
--   Same words as docs/support/sfl-guide.md / sql/116b. The rules behind it are unchanged (Admin turns
--   Shopee on for 30 days at a time).
--   Rows touched (only where the old words are found): connect-shopee (title + 3 lines),
--   other-platforms (1 line), general-settings (1 line — only present once sql/201 is applied).
-- PHRASE REPLACEMENTS, not whole rows, so it is right in either order with sql/201 (not applied yet):
--   before sql/201 → it fixes the live rows; sql/201 later writes rows that already have the new words;
--   after sql/201 → it finds nothing to change except general-settings' "(beta)" if it is still there.
-- Running it twice changes nothing the second time. "checked" becomes 2026-11-22 on a row it changes.
-- The keyword "beta" stays in connect-shopee's keywords (search only — a seller who types "beta" still
-- finds the Shopee section; keywords are never shown).
-- No Render deploy (the help bot re-reads the guide every 5 minutes).
-- NOT APPLIED. Apply after the web merge (the app then shows the new words).
-- If sql/201's rollback is ever run after this file, run this file again.
-- Rollback: sql/202_guide_shopee_no_beta_rollback.sql
-- ============================================================================
begin;
with fixed as (
  select g.id,
         case when g.id = 'connect-shopee' and g.title = 'Shopee Live (beta)' then 'Shopee Live' else g.title end as title,
         replace(replace(replace(replace(replace(g.body,
           'Shopee Live is a **beta**. Admin turns it on for you for 30 days at a time.',
           'Admin turns Shopee Live on for you for 30 days at a time.'),
           '"Shopee Beta only — upgrade to use TikTok/Facebook." During the beta, a free plan can use Shopee only.',
           '"Shopee only on your plan — upgrade to use TikTok/Facebook." On a free plan you can use Shopee only.'),
           '"Shopee Beta ended — contact Admin."',
           '"Shopee access ended — contact Admin."'),
           '- **Shopee** is a beta — see "Shopee Live (beta)".',
           '- **Shopee** — see "Shopee Live".'),
           'opens your Shopee shops (beta).',
           'opens your Shopee shops.') as body
  from public.support_guide g
  where g.id in ('connect-shopee', 'other-platforms', 'general-settings')
)
update public.support_guide g
   set title = f.title,
       body = f.body,
       checked = greatest(g.checked, '2026-11-22'::date)
  from fixed f
 where g.id = f.id
   and (g.title is distinct from f.title or g.body is distinct from f.body);
commit;
