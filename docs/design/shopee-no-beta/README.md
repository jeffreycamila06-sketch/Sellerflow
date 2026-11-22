# No "Manage Instagram accounts" row · no Shopee "Beta" (2026-11-22)

Branch `claude/great-wright-3v8plu` from main `07e10954`. Web only (Vercel). sql/202 NOT applied.

## 1. The Instagram row on the TikTok / Facebook manage screen is gone
- Who saw it before: only logins for which Instagram is open (`GET /ig/access` = true). Live check 2026-11-22:
  `ig_enabled` = 'false', 0 Instagram testers → the 3 built-in preview logins only (the owner = admin, and two
  test logins that are sellers, one of them the Meta review login).
- After: the row is gone from both manage screens (TikTok and Facebook use the same screen).
- The admin still opens the Instagram accounts screen from **Settings → Channels → Instagram box** (admins always
  see the four boxes). The old Settings rows (sellers outside the preview) never had an Instagram entry that opens
  anything: the classic card has TikTok + Facebook only, the newer list shows Instagram as "Coming soon".
- The two non-admin test logins keep one way in: the Live screen's Instagram dropdown → **Manage** (unchanged).
- Main vs this branch, the manage screen rendered with the same inputs (64 cases: TikTok / Facebook × 4 account
  states × Shopee row on/off × Facebook Pages on/off × activation notice on/off): identical HTML when Instagram is
  closed; with Instagram open, main's page minus exactly the Instagram row = this branch's page.

## 2. Shopee "Beta" is gone from what sellers see
- Live screen Shopee tile: the "Beta" badge removed (`lpk-beta`).
- Settings → Channels Shopee box: the "Beta" chip removed (it showed on laptops only), its CSS removed.
- Texts, 8 languages: "Shopee Beta · {n} days left" → "Shopee access · {n} days left";
  "Shopee Beta only — upgrade to use TikTok/Facebook" → "Shopee only on your plan — upgrade to use TikTok/Facebook";
  "Shopee Beta ended — contact Admin" → "Shopee access ended — contact Admin". The badge word key `rd_sh_beta` is removed.
- Unchanged: the rules (beta row, 30 days, Admin turns it on), the Shopee connect, and the Admin card's own
  "Shopee Beta" label (Admin screen only).

## Pictures (`shots/`)
After: `days_* / freelock_* / ended_* / grid_*` — en at 360/390/430/1280 + dark at 390, th and vi at 360.
Before (main): `BEFORE-main_*`. `fit-check.txt`: all 8 languages at 360 — no sideways scroll, nothing cut, no
"Beta" word on the page. `main-vs-branch-360.txt`: tile heights are the same everywhere; some lines take one more
line (days left in fil / vi / bg; the free-plan line in vi / id / bg; "access ended" in zh-TW).

## Help guide
Sections that said "beta": `connect-shopee` (title + 3 lines, live), `other-platforms` (1 line, live),
`general-settings` (only in sql/201's not-yet-applied text). sql/202 = phrase replacements (+ rollback), right
before or after sql/201; sql/201 now carries the same words. `sql202-behaviour.txt` (PGlite, 28 checks).
The search keyword "beta" stays in `connect-shopee` (never shown).

## Proof
`breaks.txt` — 8 on-purpose breaks, all caught.
