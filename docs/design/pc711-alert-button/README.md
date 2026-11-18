# "Send test alert" button

Admin → Controls → 7-11 Login. A small "Telegram alerts" card with one button, shown in every state of
the panel (connected, logged out, not connected). Built on 2026-11-18 after approval; the pictures were
taken from the real panel (the server's answers are faked in the picture harness).

| Picture | What it shows |
|---|---|
| `connected_*.png` | connected, before the button is tapped |
| `connected-sent_*.png` | after a tap: "Sent. Check Telegram." |
| `connected-failed_*.png` | after a tap with alerts not set up: "Not sent. Telegram alerts are not set up on the server yet." |
| `logged-out_*.png` | the card under the "Log in to 7-11" button when the server is logged out |

Widths: `iphone-390` (390 px), `android-360` (360 px), `laptop-1280` (1280 px). No sideways scroll at any
width; the button is 44 px tall and as wide as the card.

Texts (the same English text in all 8 languages, like the rest of this Admin panel):
- Title: Telegram alerts
- Line: You get a Telegram message when the server is logged out of 7-11, and when it is logged in again.
- Button: Send test alert (while sending: Sending…)
- Sent. Check Telegram.
- Not sent. Telegram alerts are not set up on the server yet.
- Not sent. Telegram did not answer. Try again.
- Not sent. Too many tries. Wait a few minutes.

The server part: `POST /admin/pc711/alert-test` (Admin only) answers `{ sent: true }` or
`{ sent: false, reason: <one word> }`.
