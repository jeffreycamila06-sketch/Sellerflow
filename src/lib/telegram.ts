// SINGLE SOURCE OF TRUTH for the SellerFlowLive support/renew Telegram handle.
// Shared by BOTH the redesign (src/redesign/*) and the rollback App.tsx, plus the
// tests (so they can never drift). Previously the handle was hardcoded in ~11
// files across three different letter-casings; a rename meant editing each. Now
// every link/button/display site imports these — change the handle here once.
//
// NOTE: the two i18n keys that embed the handle mid-sentence in 7 languages
// (rd_sup_g4_body, rd_ch_tg_handle) carry the literal string, not this constant
// (a static translation object can't import) — keep them in sync with a repo grep
// for the old number when renaming.
export const TELEGRAM_HANDLE = "@SellerFlowLive";
export const TELEGRAM_URL = "https://t.me/SellerFlowLive";
// LINE contact for the help chat. Empty = no LINE button (Jeff hasn't given a LINE link yet).
export const LINE_URL = "";
// The support chat with a ready message in the message box (Telegram's draft-text link for a username,
// t.me/<username>?text=<draft>). If Telegram can't show the draft, the chat still opens as with TELEGRAM_URL.
// Used ONLY by the Seller Website teaser card and the locked Facebook invoicing card (Invoicing);
// every other link keeps TELEGRAM_URL.
export const telegramDraftUrl = (text: string) => (text ? `${TELEGRAM_URL}?text=${encodeURIComponent(text)}` : TELEGRAM_URL);
