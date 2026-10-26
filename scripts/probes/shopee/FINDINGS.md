# Shopee PH Live comments — server-side reader probe (2026-10-27, research only)

Rules followed: read-only, no login, no captcha / bot-check circumvention, no header or
client-hint spoofing (plain `curl`, plain Node `fetch`, plain headless Chromium), polling never
faster than the server's own interval, runs capped at 5 minutes, no buyer data stored.

## Status: PARTIAL — transport identified and reachable; live message test pending
A live session id is needed for the last step (the public live LIST is bot-gated, see §2).
When a share link of an on-air live is available: `node scripts/probes/shopee/resolve.mjs <link>`
then `node scripts/probes/shopee/poll.mjs --lives <id> --minutes 5`.

## 1. What the viewer page actually does (from its own JS, `live.shopee.ph/multipages/…/pages/share-*.js` + chunk `7b32c417…`)
- The share page is a real web player (hls.js) rendered by a Next.js app on `live.shopee.ph`.
- **Session metadata:** `GET https://live.shopee.ph/api/v1/session/{session_id}` →
  `data.session.{session_id, status, chatroom_id, room_id, uid, username, title, start_time,
  viewer_count, member_cnt, play_urls, items_cnt, session_adult_info…}` (fields the page reads).
  Same pattern as the Indonesian endpoint used cookie-less by the open-source
  `classyid/shopee-live-watcher` (`live.shopee.co.id/api/v1/session/{id}`).
- **Comments = REST POLLING, not a websocket.** Module `yHl/` in the viewer chunk:
  ```
  baseURL  https://chatroom-live.shopee.ph/api/v1
  GET      /fetch/chatroom/{chatroom_id}/message?uuid={uuid}&timestamp={ts}&version=v2
  headers  Content-Type: application/json · Client-Info: os=…;platform=… · X-Livestreaming-Source: shopee
  axios    withCredentials: true (cookies sent IF the browser has them — none are required, see §3)
  loop     sleep(poll_interval) → fetch → data.{message:{msgs}, e2e_message, system, timestamp, poll_interval}
           timestamp is carried forward; default interval 2 s in code, server returns poll_interval 3
  uuid     random v4 made by the page itself (sessionStorage LIVE_STREAMING_DEVICE_UUID) — no server minting
  ```
  No `wss://` / `WebSocket` anywhere in the viewer chunks. (`.cn` builds use `zhibo-danmu.xiapi…`.)

## 2. Evidence from plain requests (Taiwan IP, Mac, 2026-10-26 ~16:15–16:25 UTC)
| call | result |
|---|---|
| `GET https://live.shopee.ph/` (host console SPA) | 200 |
| `GET https://live.shopee.ph/api/v1/session/1` (bogus id, no cookies) | **403** `{"error":90309999,"is_login":false,"redirect_to_error_page":true}` |
| `GET https://live.shopee.ph/api/v1/session/0` (from inside the headless share page) | 200 `{"err_code":1000000,"err_msg":"params invalid"}` |
| `GET https://live.shopee.ph/api/v1/lptab/tab` (landing tabs, no cookies) | 200, 6 tabs |
| `GET https://live.shopee.ph/api/v1/lptab/item?tab_id=…` (the public live LIST) — curl | **403** error 90309999 |
| same, requested by the page itself in plain headless Chromium | 200 but body = the same error 90309999 → the SPA redirects to `shopee.ph/buyer/login` |
| `GET https://chatroom-live.shopee.ph/api/v1/fetch/chatroom/1/message?uuid=…&timestamp=0&version=v2` (bogus room, no cookies, viewer headers) | **200** `{"code":0,"msg":"success","data":{"system":{},"timestamp":0,"poll_interval":3,…}}` |
| same with only a User-Agent (no custom headers) | **200**, identical body |
| same with `version` omitted | **200**, identical body |

Reading of the 403s: `error 90309999` with `is_login:false` is Shopee's anti-fraud gate
(the real page sends `af-ac-enc-dat`, `af-ac-enc-sz-token`, `x-ls-sz-token`, `x-sap-ri` headers
minted by its JS; plain requests — and a plain headless browser — don't pass). That gate sits
on the **live list** and on the **session metadata when called bare**; it did NOT sit on the
chat-room service. A request to spoof client hints was refused by policy (and by Jeff's rule) — nothing
was evaded.

## 3. What the comment feed needs (so far)
- Login cookie: **no** (bogus-room poll answered 200/code 0 with zero cookies).
- Guest token / signature: **none observed** on `chatroom-live` — it only *offers* guest cookies
  (`SPC_*`, `REC_T_ID`) in its response; they were not required.
- Per-live cost: the `uuid` is client-generated, so one uuid can serve many lives (or one per live, free).
- Region: both hosts answered from a Taiwan IP; nothing so far suggests a PH IP is required.
  Render (US) is untested — the `.ph` host + Akamai/SGW front may geo-vary; re-run `poll.mjs` from Render before deciding.
- Still unknown until a real live: whether a real `chatroom_id` needs the session-metadata call
  (bot-gated when bare) to be obtained, the message shape, and end-to-end delay.

## 4. Scalability notes (REST polling, one Render IP, ~50 lives)
- Transport = polling; the server dictates `poll_interval` (3 s observed) → **~20 req/min per live**,
  ~1,000 req/min for 50 lives from one IP. Never poll below the returned interval.
- Rate-limit signals seen so far: none (no 429, no `Retry-After` / `x-ratelimit-*` headers) — but only
  single bogus-room calls were made; the concurrent 2–3-live test is what `poll.mjs` measures.
- Risk that one IP serving ~50 lives gets throttled: **medium** — the chat service is permissive
  today, but the surrounding Shopee stack runs an active anti-fraud gate (`90309999`) and the
  reader would look like 50 viewers behind one IP with no browser fingerprint. Mitigations:
  honour `poll_interval`, one uuid per live, back off on non-200/code≠0, stop at live end.

## 5. Verdict so far
**FEASIBLE WITH CONDITIONS (pending the live message test).** The comment path is a plain,
unauthenticated REST poll. The conditions: (a) getting `chatroom_id` for a session — the bare
session endpoint is bot-gated, so the share link must resolve some other allowed way (the
share page itself, a seller-provided id, or a non-gated variant still to be confirmed);
(b) Render-IP behaviour unverified; (c) ToS: Shopee's terms restrict automated access — a
business/legal call, same class as the TikTok reader.

## 6. How it would plug in (if confirmed)
Server-side reader like `server/fbLive.js`: `shopeeLive.js` with `connect(shareLink)` →
`resolveSessionId` → `sessionMeta` (chatroom_id, status) → a per-live poll loop at the server's
`poll_interval` → normalize `msgs` → the SAME `emitCommentScoped` relay (sanitize, msgId dedup)
the TikTok reader feeds; stop on `status` ended / repeated empty polls; one uuid per live.
