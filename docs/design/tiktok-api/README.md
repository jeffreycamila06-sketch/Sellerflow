# TikTok API — UI design previews (Step 1, 2026-11-02, branch claude/tiktok-connect)

Mobile-first mock-ups at 390 px, light and dark, following docs/plans/tiktok-api.md "UI design brief".
Screens: `01`–`04` the Settings card "TikTok videos — sell from comments" in its four states (not
connected / connected / connect again / personal account) on the Manage TikTok accounts screen
(Branch 1); `05` Orders → Posts with platform chips (shown only when 2+ platforms are connected);
`06` TikTok video picker (list rows: 9:16 thumbnail, caption 2 lines, date, "Selling" badge — same
look as the FB post list); `07` Sell sheet (name on its own line, code / price / stock in one row,
Codes | +1 toggle, auto-reply / hide status chips); `08` active sale card ("Orders · Sold", End, last
comment time); `09` a TikTok order on the Posts tab with its sticker (Branch 2).
`overview-light.png` / `overview-dark.png` = all nine on one sheet.
`sticker-tiktok-post-order-60x40.png` was rendered by the production sticker functions (post order
rule: no buyer number, @username + its QR, the comment; layout v2 ON, 60×40, 2× scale).
Neutral note icon (♪), no TikTok logo. Strings are English drafts; the build adds all 8 languages.
