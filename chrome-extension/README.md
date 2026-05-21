# SellerFlow Live Comment

Chrome extension for grabbing visible TikTok LIVE viewer comments and sending them to SellerFlowLive.

## What It Does

- Shows a movable floating widget on TikTok pages.
- Has `START` and `STOP` buttons.
- Remembers if it was started, then auto-starts again on TikTok pages.
- Captures only likely real viewer comments.
- Ignores common non-comment activity such as likes, joins, follows, viewers, gifts, rankings, and system text.
- Sends captured comments to the SellerFlow backend at `http://localhost:3001/browser-helper/comment`.

## Install In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder: `chrome-extension`.
6. Open a TikTok LIVE page.
7. Click `START` in the floating `SellerFlow Live Comment` widget.

## Notes

- Keep the SellerFlow backend running on port `3001`.
- Keep SellerFlowLive open so it can receive comments from the backend.
- The widget can be dragged anywhere on the page.
- TikTok layout changes can require selector updates.
