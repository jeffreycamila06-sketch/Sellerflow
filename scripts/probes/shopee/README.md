# Shopee PH Live comment probe (research only — no app/server code)

Question: can SellerFlowLive's **server** read Shopee PH Live comments from just the live
share link — no seller login, no browser extension — the way the TikTok/FB readers work?

Rules the scripts follow: read-only (nothing posted, liked or sent), no login, no captcha or
bot-check circumvention, polling never faster than the server's own `poll_interval` (≥ 2 s),
a run stops after 5 minutes, and no buyer data is stored — only counts, timings and at most
three sample comments with usernames masked (`j***a`).

## Files
- `resolve.mjs` — share link / short link / session id → `session_id` → the public session
  metadata (`chatroom_id`, status, viewer count…). Prints what the metadata endpoint needs.
- `poll.mjs` — polls the chat-room message endpoint for one or more lives in parallel
  (plain Node `fetch`, no browser), logs per-live request counts, status codes, latency,
  message counts and masked samples. `--minutes 5 --lives <id1,id2,…>`.
- `FINDINGS.md` — the report (endpoints, status codes, scalability, risks, verdict).

## How the viewer page works (from its own JS bundle, 2026-10-27)
- Session metadata: `GET https://live.shopee.ph/api/v1/session/{session_id}` →
  `data.session.{chatroom_id, status, play_urls, viewer_count, member_cnt, uid, username, title, start_time…}`
- Comments: `GET https://chatroom-live.shopee.ph/api/v1/fetch/chatroom/{chatroom_id}/message?uuid={client uuid}&timestamp={last ts}&version=v2`
  — plain REST polling (no websocket), the response carries `poll_interval` (seconds) and the
  next `timestamp`; `uuid` is a random v4 the viewer makes itself (`LIVE_STREAMING_DEVICE_UUID`).
  Headers the page sends: `Client-Info: os=…;platform=…`, `X-Livestreaming-Source: shopee`.
