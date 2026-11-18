# "Send test alert" button — pictures only (not built yet)

Admin → Controls → 7-11 Login. A small "Telegram alerts" card with one button, shown in every state of
the panel (connected, logged out, not connected). The pictures were taken from the real panel with the
card added as a mock-up; the card is NOT in the app yet.

| Picture | What it shows |
|---|---|
| `connected_*.png` | connected, before the button is tapped |
| `connected-sent_*.png` | after a tap: "Sent. Check Telegram." |
| `connected-failed_*.png` | after a tap with alerts not set up: "Not sent. Telegram alerts are not set up on the server yet." |
| `logged-out_*.png` | the card under the "Log in to 7-11" button when the server is logged out |

Widths: `iphone-390` (390 px), `android-360` (360 px), `laptop-1280` (1280 px). No sideways scroll at any
width; the button is 44 px tall and as wide as the card.

Texts (English; the real build adds the other languages):
- Title: Telegram alerts
- Line: You get a Telegram message when the server is logged out of 7-11, and when it is logged in again.
- Button: Send test alert (while sending: Sending…)
- Sent. Check Telegram.
- Not sent. Telegram alerts are not set up on the server yet.
- Not sent. Telegram did not answer. Try again.

The server part is built: `POST /admin/pc711/alert-test` (Admin only) answers `{ sent: true }` or
`{ sent: false, reason: <one word> }`.
