-- ============================================================================
-- sql/191 — help guide, ONE new row of support_guide, 2026-11-20: "blacklist" (Blacklist, sellers outside
-- Taiwan). The live table has no such row (read 2026-11-20: 51 rows, 0 with id blacklist). The text is the
-- "blacklist" section of docs/support/sfl-guide.md (= sql/116b). Every other row stays as it is. Running it
-- twice changes nothing the second time. No Render deploy (the help bot re-reads the table every 5 minutes).
-- NOT APPLIED. Apply AFTER sql/190 and the web merge (the guide must not describe a screen sellers cannot
-- open yet — while blacklist_enabled is false only testers see it; apply when it goes to every seller, or
-- earlier if the testers should be able to ask the help bot). Rollback: sql/191_guide_blacklist_rollback.sql
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('blacklist', 'Blacklist (sellers outside Taiwan)', '2026-11-20'::date, 'blacklist, bad buyer, bogus buyer, joy reserver, not checked out, return, returned, block buyer, hindi nag-check out, nag-return, bogus, 黑名单, 黑名單, 退货, 退貨, 未结账', 'Blacklist is for sellers outside Taiwan. Open **Settings → Blacklist**. Only you can see your list.

**Add a buyer**
1. Pick a reason: **Not checked out** or **Return item**.
2. Tap **Scan sticker QR** and take a photo of the QR on the buyer''s sticker (on a laptop: **Upload sticker photo**). Or tap **TikTok** or **Facebook**, type the TikTok @username or the Facebook name, and tap **Add**.

- The sticker has a QR only when **Print QR on sticker** is on and the sticker is taller than 40 mm. Otherwise type the name.
- Facebook buyers have no QR: type their Facebook name exactly as it shows.
- Tap **Undo** right after adding if you picked the wrong buyer or reason.
- The same buyer with the same reason counts once a day. Adding it again that day shows **Already added today**.
- **This QR has no buyer** means it is not a SellerFlowLive sticker QR. Type the username instead.
- **2 stickers in the photo — show only one**: take the photo again with only one sticker in it.

**Your list**
- Each buyer shows how many times per reason, the date last added, and TikTok or Facebook. Use **Search buyer** to find one.
- **Remove** takes the buyer off your list (you are asked first).

**On your live**
- When a buyer on your list comments, the comment turns red and shows how many times, for example "2× Return · 1× Not checked out". Tap the buyer''s name to see the dates.
- It is a reminder only: the order still prints as usual. Your viewers never see it.
- The TikTok @username or the Facebook name must match exactly.
- A buyer you add during a live shows right away on this phone, and on your other phones from your next live.')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
