-- Rollback of sql/209: the three phrases back to their old words (only where the new words are found).
-- "checked" is left as it is.
begin;

update public.support_guide
   set body = replace(body, '**Scan QR** fills in the buyer @username from a SellerFlowLive sticker. In the latest phone app the camera opens: point it at the QR on the sticker and it is read by itself. If it says **Point at one QR**, move closer to just one sticker. Tap **Take a photo instead** to use a photo, or **Open Settings** if the camera is off for SellerFlowLive. On a computer, pick a photo of the sticker. Show only one sticker in a photo: with 2 or more, nothing is filled in and the app asks you to show only one.', '**Scan QR** fills in the buyer @username from a SellerFlowLive sticker photo. Show only one sticker in the photo: with 2 or more, nothing is filled in and the app asks you to show only one.'),
       checked = checked
 where id = 'parcel-scan'
   and position('**Scan QR** fills in the buyer @username from a SellerFlowLive sticker. In the latest phone app the camera opens: point it at the QR on the sticker and it is read by itself. If it says **Point at one QR**, move closer to just one sticker. Tap **Take a photo instead** to use a photo, or **Open Settings** if the camera is off for SellerFlowLive. On a computer, pick a photo of the sticker. Show only one sticker in a photo: with 2 or more, nothing is filled in and the app asks you to show only one.' in body) > 0;

update public.support_guide
   set body = replace(body, '2. Tap **Scan sticker QR** and point the camera at the QR on the buyer''s sticker, or use a photo of it (on a laptop: **Upload sticker photo**).', '2. Tap **Scan sticker QR** and take a photo of the QR on the buyer''s sticker (on a laptop: **Upload sticker photo**).'),
       checked = checked
 where id = 'blacklist'
   and position('2. Tap **Scan sticker QR** and point the camera at the QR on the buyer''s sticker, or use a photo of it (on a laptop: **Upload sticker photo**).' in body) > 0;

update public.support_guide
   set body = replace(body, '- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.
- In the latest phone app, **Scan** (next to the search box) reads the QR on a buyer''s sticker with the camera and opens that buyer''s card for the session you have open: all their orders and the total. "No orders for @username in this session" means that buyer has no orders there. Type in the search box to search as usual again.', '- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.'),
       checked = checked
 where id = 'orders-search'
   and position('- Type only a **buyer number** (for example 3) to see that buyer''s card: all their orders and the total. If you see "2 buyers have #3 — pick one", tap the right buyer to open their card.
- In the latest phone app, **Scan** (next to the search box) reads the QR on a buyer''s sticker with the camera and opens that buyer''s card for the session you have open: all their orders and the total. "No orders for @username in this session" means that buyer has no orders there. Type in the search box to search as usual again.' in body) > 0;

commit;
