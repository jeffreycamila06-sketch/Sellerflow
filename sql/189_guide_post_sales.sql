-- ============================================================================
-- sql/189 — help guide, ONE row of support_guide: "post-sales" (Posts: sell on a Facebook post),
-- 2026-11-20. The row is NOT in the live table today (read 2026-11-20: no post-sales row), so this
-- adds it; the text is the section of docs/support/sfl-guide.md (= sql/116b). Every other row stays
-- as it is. Running it twice changes nothing the second time. No Render deploy (the help bot re-reads
-- the table every 5 minutes).
-- NOT APPLIED. Apply AFTER the web merge and after sql/188. Rollback: sql/189_guide_post_sales_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('post-sales', 'Posts: sell on a Facebook post', '2026-11-20'::date, 'post, posts, posts tab, facebook post, sell on a post, comment code, +1, +2, post orders, print new, my posts, end date, 14 days, locked, magbenta sa post, 帖子, 貼文, 留言下单, 貼文賣貨', 'If your Facebook Page is connected, the **Orders** screen has a **Live | Posts** switch at the top. **Posts** is for selling on a normal Facebook post: buyers comment under your post and the order is made for you.

Posts is on the **Plus**, **Pro** and **Master** plans. On Free or Basic, Posts shows a 🔒 — tap it to contact support.

**Start selling on a post**
1. **Orders → Posts → ＋ Sell on a post**.
2. Pick one of your Page''s recent posts.
3. Choose how buyers order: **Comment a code** (each item has a code like A, B, C) or **"+1" for one item**.
4. Add your items: name, code, price and stock (leave stock empty for no limit). **Pick from Products** fills an item from your Products list.
5. Under **Ends**, tap **−** or **+** to choose how many days it runs: 7 days at first, up to 14 days. Then tap **Start selling**.

**How buyers order**
- The comment must be **only the code**: "A" counts, "A po" or "A please" does not. With **"+1"**, a buyer comments **+1** for one piece, **+2** for two, up to **+10**.
- Each buyer gets **one order per code** on a post. To buy two, comment **+2** once. Commenting +1 twice still makes one order.
- Only comments written **directly under your post** count. Replies to someone''s comment and comments on a shared copy of the post do not.
- A code can be on one selling post at a time. Several **"+1"** posts can sell at the same time.
- When an item is sold out, later buyers go to the waitlist.

**Your post orders**
- New orders come in within about a minute. They show when you open **Orders**. If Orders is already open, go to another screen and come back.
- Orders show in **Posts** as one card per buyer, with the items, the total and a **New** or **Printed** pill.
- Tap **Print new** to print stickers for the new buyers. Post stickers have **no buyer number** and show "Post" on each item line. Nothing prints by itself.
- **My posts** shows each post as **Selling**, **Sold out** or **Ended**. There you can **End now** or **Edit** an item''s price and stock.
- If your plan ends, Posts is locked and your posts take no new orders. Renew before a post''s end date and it takes orders again, including comments buyers wrote in between.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
