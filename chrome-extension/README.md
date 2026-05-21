# SellerFlow Live Comment

Chrome extension for grabbing visible TikTok LIVE viewer comments and sending them to SellerFlowLive.

## What It Does

- Shows a movable floating widget on TikTok pages.
- Has `START` and `STOP` buttons.
- Remembers if it was started, then auto-starts again on TikTok pages.
- Captures only likely real viewer comments.
- Ignores common non-comment activity such as likes, joins, follows, viewers, gifts, rankings, and system text.
- Sends captured comments directly to an open SellerFlowLive tab through Chrome extension messaging.
- Optional backend URL field can be used as fallback, for example `http://localhost:3001`.

## Install In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder: `chrome-extension`.
6. Open SellerFlowLive in another tab and make sure you are logged in.
7. Open a TikTok LIVE page.
8. Click `START` in the floating `SellerFlow Live Comment` widget.

## Notes

- Keep SellerFlowLive open so it can receive comments from the extension.
- The widget can be dragged anywhere on the page by holding the widget body/header.
- If you want backend fallback, type your backend base URL into the optional backend field.
- TikTok layout changes can require selector updates.
