-- ============================================================================
-- sql/202 ROLLBACK — puts the word "beta" back into the Shopee help text (the exact reverse of
-- sql/202's phrase replacements). Running it twice changes nothing the second time.
-- "checked" is left as it is (it only says when the row was last looked at).
-- ============================================================================
begin;
with back as (
  select g.id,
         case when g.id = 'connect-shopee' and g.title = 'Shopee Live' then 'Shopee Live (beta)' else g.title end as title,
         replace(replace(replace(replace(replace(g.body,
           'Admin turns Shopee Live on for you for 30 days at a time.',
           'Shopee Live is a **beta**. Admin turns it on for you for 30 days at a time.'),
           '"Shopee only on your plan — upgrade to use TikTok/Facebook." On a free plan you can use Shopee only.',
           '"Shopee Beta only — upgrade to use TikTok/Facebook." During the beta, a free plan can use Shopee only.'),
           '"Shopee access ended — contact Admin."',
           '"Shopee Beta ended — contact Admin."'),
           '- **Shopee** — see "Shopee Live".',
           '- **Shopee** is a beta — see "Shopee Live (beta)".'),
           'opens your Shopee shops.',
           'opens your Shopee shops (beta).') as body
  from public.support_guide g
  where g.id in ('connect-shopee', 'other-platforms', 'general-settings')
)
update public.support_guide g
   set title = b.title,
       body = b.body
  from back b
 where g.id = b.id
   and (g.title is distinct from b.title or g.body is distinct from b.body);
commit;
