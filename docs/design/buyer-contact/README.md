# Buyer contact — previews (real app screens)

78 screenshots of the REAL screens (`docs/plans/buyer-contact.md`), taken from the app running on an
in-memory fake database (`src/dev/fakeSupabase.ts` via `vite.preview.config.ts`), at iPhone 390×844,
Android 412×915 and computer 1280×900, light + dark (`<state>_<device>_<theme>.jpg`, 2× pixel ratio).

States: `manual-{tiktok,line,whatsapp,facebook,instagram,other}` (Parcel Scan manual entry, each platform
selected) · `scan-qr-tiktok` (Scan QR fills the handle and selects TikTok) · `no-contact` · `whatsapp-error` ·
`edit-card` (a saved WhatsApp parcel) · `customers-import` (Customer Details import row) · `pickup-status`
(phone card list / desktop table — WhatsApp, LINE, Facebook, Instagram, TikTok, legacy "(IG)" and "Other" rows) ·
`fm-manual` (Parcel Scan FamilyMart) · `pickup-status_iphone390_light_{fil,bg}` (Filipino and Bulgarian at 390 — the
longest "Copy message" / "Chase" labels; the Copy message button ellipsises at 124 px so the name column keeps its room).

Regenerate: start the preview server (`npx vite --config vite.preview.config.ts --port 5199`), then run the
Playwright script kept in the hand-over note (needs Google Chrome; `playwright-core` + `qrcode` from npm).
