# Invite friends — invite code + referral reward (branch `claude/invite-referral`)

Real screens of the built feature, taken from the real app running on the preview database
(`src/dev/fakeSupabase.ts`). Phone widths 360 / 390 / 430 and a 1280 laptop.

```bash
npx vite --config vite.preview.config.ts --port 5199
```
```bash
node docs/design/invite-referral/make-shots.cjs
```

| # | Screen | What it shows |
|---|--------|---------------|
| 1 | Settings | The **Invite friends** card (now opens its own screen). |
| 2 | Invite friends, no code yet | Type a word → live check "Available ✓"; **Give me a random code**; the 🔒 warning. |
| 3 | Same, after **Save code** | The in-page step "Save BUDGETUKAY as your invite code? It can't be changed later." (no browser pop-up). |
| 4 | Invite friends, has a code | Code BIG, **Copy**, **Share**, "This month: +10 free days …", **Your invites** with pills. |
| 5 | Free seller | "Free days from invites are for paid plans only." + **Invited by a friend? Enter code** with "Code found ✓". |
| 6 | iPhone app (`?ios=1`) | Same screen with neutral words: no "subscribe", "paid", "plan", price or buy link. |
| 7 | Sign-up | **Invite code (optional)** box with "Code found ✓". Never blocks Create account. |
| 8 | Admin → Manage sellers card | Green line "Invited by X (Pro). X gets +10 days when you save." + the seller's code + **Change code**. |
| 9 | Admin → Invite rewards | Current month (Now) + next 5, days box each, empty/0 = Off. |
| 10 | Admin → Invite history | Inviter (code) → friend, status, date; **Revoke** asks inside the page. |

Preview switches (preview database only, never shipped): `?inv=choose` (no code yet), `?inv=free`
(free seller), `?admin=1` (admin role), `?anon=1` (signed out), `?ios=1` (iPhone wording).
