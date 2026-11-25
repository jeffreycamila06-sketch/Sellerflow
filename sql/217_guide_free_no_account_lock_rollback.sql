-- ============================================================================
-- Rollback of sql/217 — puts back the two LIVE rows as they were before sql/217 (checked 2026-11-25 on production:
--   account-limit    checked 2026-11-22, keywords md5 ba84c72ffdb056d66ffb04eec72318dc, body md5 f6b7bf262d0a277c8b69be5223078548
--   manage-accounts  checked 2026-11-22, keywords md5 1ad4ef2a5d636f90ca41a70f68eec514, body md5 8ab2f0c3802ccebc27497d102e7ce844).
-- ============================================================================
begin;
insert into public.support_guide (id, title, checked, keywords, body) values
  ('account-limit', 'Account limit per plan', '2026-11-22'::date, 'account limit, accounts, multi account, add account, limit reached, plan full, remove account, wait 4 hours, end your live first, ilang account, dagdag account, puno na, 账号上限, 多帳號, 帳號數量, 方案已滿', 'Your plan sets how many live accounts you can have **in total across all live platforms** (TikTok, Facebook, Instagram and Shopee together): Free 1, Basic 1, Plus 2, Pro 3, Master 5. Each Shopee shop counts as one account.

When your plan is full, a **Plan full** window shows your accounts:
- Tap **Remove** next to one, then **Remove** again to confirm. Your orders and stickers stay.
- An account that is live right now shows **End your live first** — end that live, then remove it.
- Or tap **Upgrade plan** (on iPhone: **Contact Admin**).
- After you remove an account you can add a **different** one right away. That new account then can''t be removed or changed again for **4 hours** ("Wait a little" shows the time left). Adding the same account back works right away.

Messages you may see:
- "Accounts used: 2 of 3" — your count.
- "Plan account limit reached" or "⚠ Your plan''s account limit is reached. Upgrade to add more."
- "Only your N oldest can go live" / "Not covered by your plan" — you have more accounts than your plan covers. Only the oldest ones can go live.

What to do:
1. Remove an account you no longer use, or
2. Upgrade your plan: message Admin on Telegram @SellerFlowLive.
3. To add an extra TikTok account beyond your plan, tap **Add TikTok — Multi Account** and message Admin on Telegram.'),
  ('manage-accounts', 'Manage TikTok accounts (4-hour lock)', '2026-11-22'::date, 'manage accounts, change username, tiktok username, locked, unlock, 4 hours, palitan account, naka-lock, 更改账号, 換帳號, 锁定', 'Go to **Settings → General Settings → TikTok Live** (or **Manage / add accounts** on the Live screen). This opens **Manage TikTok channels**.

- Type your username in an empty row (lowercase letters, numbers, underscores and periods) and tap **Save profile**.
- A saved account shows **LOCKED**. After a change it stays locked for **4 hours** ("Unlock in Xh Ym").
- When it unlocks you see **Change**. Tap it, and you have a short time to edit ("You can change this now — … left"). After saving, it locks again for 4 hours.
- "This username was changed recently. Please try again later." means the 4 hours are not over.
- Empty rows only go up to your plan''s limit. For more, tap **Add TikTok — Multi Account** and message Admin on Telegram @SellerFlowLive.
- When your plan is full, the **Plan full** window opens instead (see "Account limit per plan").')
on conflict (id) do update set
  title = excluded.title, checked = excluded.checked, keywords = excluded.keywords,
  body = excluded.body, updated_at = now()
where (support_guide.title, support_guide.checked, support_guide.keywords, support_guide.body)
  is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body);
commit;
