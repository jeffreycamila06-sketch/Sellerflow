# Send to chat — what each app supports (Seller Website Phase 1)

The order is **saved first** (`website_place_order`). The chat buttons on the "Order sent" page and the
order link are real `<a href>` links (tapped directly — the only way an external app reliably opens from the
iPhone web view, see CLAUDE.md "SLIDE→BUTTON"). Each tap also copies the order text; the toast says
**"Order copied, paste it in <app>"**.

| App | Link | Order typed in for the buyer? | Official doc |
|---|---|---|---|
| WhatsApp | `https://wa.me/<number>?text=<order>` | **Yes** (prefill) — buyer still taps Send | WhatsApp Help Center "How to use click to chat" (faq.whatsapp.com — not fetched from this session; the `?text=` parameter is the documented one) |
| LINE (Official Account, ID like `@abc`) | `https://line.me/R/oaMessage/%40abc/?<order>` | **Yes** (prefill) — only for an Official Account ID | [Use LINE features with the LINE URL scheme](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme) — "Sending text messages to an Official Account". ⚠️ The LINE Login copy of the page says to leave out the `@`; we send `%40` like the Messaging API page. |
| LINE (no text) | `https://line.me/R/ti/p/@abc` | — (opens the account) | same page |
| Messenger | `https://m.me/<page>` | **No — copy only.** Meta lists a `text` parameter, but it is the message the *business* sends, not the buyer's draft; we don't rely on it. | [m.me Links](https://developers.facebook.com/docs/messenger-platform/discovery/m-me-links) |
| Instagram | `https://ig.me/m/<username>` | **No — copy only.** Only a `ref` parameter is documented. | [Using ig.me Links](https://developers.facebook.com/docs/messenger-platform/instagram/features/ig-me-links) |

## What Jeff must test on a real phone (iPhone + Android, each app installed AND not installed)

1. WhatsApp: tap → WhatsApp opens on the seller's chat with the order already typed. Not installed → the wa.me web page.
2. LINE with an Official Account ID (`@…`): tap → LINE opens the OA chat with the order typed. If the buyer is not a friend yet, check what LINE shows (third-party notes say the add-friend screen).
3. LINE with a personal ID (no `@`): the seller should enter their OA ID; a personal ID will not open a chat this way — check what happens and decide whether the editor should say "LINE Official Account ID only".
4. Messenger: tap → Messenger opens the Page chat; long-press → Paste puts the full order. Check inside the Facebook in-app browser too (buyers often open the shop from a FB post).
5. Instagram: tap → Instagram opens the DM; Paste works. Check from the Instagram in-app browser.
6. Copy: after each tap, open Notes and Paste — the full order text with the order link must be there (iPhone Safari, Chrome Android, the FB / IG / LINE in-app browsers).
