# TikTok API — demo script (Branch 1; extended each branch)

Recorded on production as admin (camilajeffrey1@gmail.com, preview key `tiktok_api`), on a phone at
390 px. Every step starts from a real screen; nothing is mocked. The video opens on TikTok's own
consent screen. Fallback: if TikTok rejects a scope, the app still works without it (the card then
shows what it can — username only — and says so in seller words).

| # | Scope (TikTok) | Seller story (why) | Screen | Action | Expected result |
|---|---|---|---|---|---|
| 1 | — | A seller whose LIVE is paused still wants to sell from the comments under her videos | Settings → Manage TikTok accounts | Scroll to the card **TikTok videos — sell from comments** | The card shows one line ("Sell from the comments on your videos. No live needed.") and **Connect TikTok videos** |
| 2 | user.info.basic, user.info.username, user.info.stats, user.account.type | She connects the TikTok Business account she already registered as her live username | Card → **Connect TikTok videos** | Tap; TikTok's consent screen opens in the in-app sheet (web: a new tab) | TikTok lists the four permissions; she taps Allow |
| 3 | (same) | The app checks the account is a Business account and one of her registered usernames | TikTok consent → back in the app | Automatic return (`?tt=connected`) | Toast "TikTok videos connected."; the card shows her avatar, **@username**, follower count and **● Connected** |
| 4 | — | What happens with a personal account | Same flow with a personal TikTok account | Allow | TikTok sends her back; the card shows **"This TikTok account is a personal account"** with the in-app steps to switch, and **Connect again** |
| 5 | — | What happens with an account she did not register | Same flow with another Business account | Allow | Toast "…isn't one of your registered TikTok usernames. Add it in Manage TikTok accounts first." — nothing is stored |
| 6 | — | TikTok ended the connection (password change / app removed in TikTok) | Card after the token is refused | Open the card | **Connect again** badge + the paused notice; tapping it runs step 2 again |
| 7 | — | She stops using it | Card → **Disconnect** | Tap | Toast "TikTok videos disconnected."; TikTok's access is revoked and the saved connection deleted; the card is back to step 1 |
| 8 | — | Admin check (web only) | Admin → **TikTok videos** | Open | One line per connected account: seller email, @username, last poll, last webhook, token expiry |

Privacy pages (recorded as a scroll): sellerflowlive.com/privacy (the "TikTok data" paragraph) and
/delete-account (how to remove SellerFlowLive in the TikTok app; what deleting the account removes).

Later branches add rows: video picker + Sell sheet + a comment becoming an order (Branch 2), auto-reply /
hide / Insights (Branch 3), Business Messaging (Branch 4), posting + username verify (Branch 5).
