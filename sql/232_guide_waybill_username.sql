-- ============================================================================
-- sql/232 — help guide for Waybill username (TikTok Shop, Philippines) (2026-11-27).
--   1. ONE new row of support_guide: "waybill-username" (same words as docs/support/sfl-guide.md / sql/116b).
--   2. ONE sentence of the "shipping" row: "Sellers in other countries do not see Shipping."
--      → "For TikTok Shop waybills in the Philippines, see **Waybill username**."  ("checked" becomes 2026-11-27).
--      A PHRASE change, not the whole row: it runs only where the old sentence is found, so running this
--      file twice changes nothing the second time. The old sentence was checked on the live row 2026-11-27
--      (read only: found at position 112, row md5 3719f5a1bd3ef07c53e11568520447bb).
-- No Render deploy (the help bot re-reads the guide every 5 minutes).
-- NOT APPLIED. Apply AFTER waybill_username_enabled is turned on (sql/231): before that, Philippines sellers
-- do not see Waybill username yet. Do NOT apply sql/116b for this.
-- Rollback: sql/232_guide_waybill_username_rollback.sql
-- ============================================================================
begin;

insert into public.support_guide (id, title, checked, keywords, body) values
  ('waybill-username', 'Waybill username (TikTok Shop, Philippines)', '2026-11-27'::date, 'waybill, waybill username, shipping label, label, j&t, tiktok shop, buyer username, username on waybill, pangalan sa waybill, resi, 运单, 託運單, 用户名, 帳號', 'Waybill username puts each buyer''s **@username** on their TikTok Shop waybill, so you know whose bag it is. It is for sellers in the Philippines. Open **Settings → Shipping → Waybill username**.

1. In TikTok Shop Seller Center, download the order list (**Orders → Export → CSV**) and the waybills (**Shipping labels → Print / download**).
2. Tap **Choose order list (CSV)** and pick the CSV. Tap **Choose waybill PDF** and pick the PDF.
3. Tap **Add usernames**.
4. Check the list. A green **@username** is ready. **Pick buyer** means you choose: pick from your buyers of today and yesterday, or search. **No match — leave blank** prints that waybill without a username.
5. On a phone, tap **Download PDF** and save or share the file. On a laptop, tap **Print** or **Download PDF**.

- Buyers come from your TikTok lives today and yesterday.
- Tap a green @username to change it.
- **Couldn''t place the username on this waybill**: that waybill prints as it is, without a username.
- **Not in the order list**: download the order list again so it has that order.
- You can do this many times a day. Your files are not saved.
- In Taiwan, Waybill username shows **Soon**.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords, body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);

update public.support_guide
   set body = replace(body, 'Sellers in other countries do not see Shipping.', 'For TikTok Shop waybills in the Philippines, see **Waybill username**.'),
       checked = greatest(checked, '2026-11-27'::date)
 where id = 'shipping'
   and position('Sellers in other countries do not see Shipping.' in body) > 0;

commit;
