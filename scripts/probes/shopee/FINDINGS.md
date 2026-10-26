# Shopee Live comments — server-side reader probe (2026-10-27, research only)

Rules followed: read-only, no login, no captcha / bot-check circumvention, no header or
client-hint spoofing (plain `curl`, plain Node `fetch`, plain headless Chromium), polling never
faster than the server's own interval, runs capped at 5 minutes, no buyer data stored
(masked samples only). Two probes that would have crossed those lines were refused by the
policy classifier and dropped: spoofing Chrome client hints, and probing other session
sub-resources for a host id after the session endpoint said no.

## Verdict: FEASIBLE WITH CONDITIONS — for a seller's OWN live (message test PASSED on TW, 2026-10-27)
Live comments were read from a plain Node process with no login, no cookie, no token and no
spoofing: 41 comments in 3 minutes, every one logged, 1–4 s behind the moment they were sent
(= the server's 3 s poll interval), zero errors. Details in §3.

## 1. How the viewer page works (from its own JS, `live.shopee.<cc>/multipages/…/pages/share-*.js` + chunk `7b32c417…`)
- The share page is a real web player (hls.js) in a Next.js app on `live.shopee.<cc>`;
  the HTML is an empty shell (`__NEXT_DATA__.pageProps = {}`), everything comes from APIs.
- **Session metadata:** `GET https://live.shopee.<cc>/api/v1/session/{session_id}` →
  `data.session.{session_id, status, chatroom_id, room_id, uid, title, start_time, end_time,
  member_cnt, viewer_count, play_urls…}`.
- **Comments = REST POLLING, no websocket** (module `yHl/`):
  ```
  baseURL  https://chatroom-live.shopee.<cc>/api/v1
  GET      /fetch/chatroom/{chatroom_id}/message?uuid={uuid}&timestamp={ts}&version=v2
  headers  Content-Type: application/json · Client-Info: os=…;platform=… · X-Livestreaming-Source: shopee
  loop     sleep(poll_interval) → fetch → data.{message:{msgs}, e2e_message, system, timestamp, poll_interval}
           timestamp carried forward; code default 2 s, server returns poll_interval 3
  uuid     random v4 the page makes itself (sessionStorage LIVE_STREAMING_DEVICE_UUID) — no server minting
  ```
  No `wss://` / `WebSocket` in any viewer chunk.

## 2. Evidence — plain requests from a Taiwan IP (2026-10-26 16:15 → 16:50 UTC)
| call (no cookies unless stated) | result |
|---|---|
| `GET https://tw.shp.ee/o4Nt76Re` (short share link) | 301 → `live.shopee.tw/share?from=live&session=8091046&share_user_id=…` |
| `GET live.shopee.tw/api/v1/session/8091046` (curl) | **403** `{"error":90309999,"is_login":false,"redirect_to_error_page":true}` |
| same call made BY the real share page in plain headless Chromium (page's own `af-ac-enc-*`, `x-ls-sz-token`, `x-sap-*` headers) | 200 with the SAME error body → page bounces to `shopee.tw/buyer/login` |
| `GET live.shopee.ph/api/v1/lptab/item?…` (public live LIST, curl and headless) | 403 / error 90309999 |
| **`GET live.shopee.tw/api/v1/host_session?uid={host uid}`** | **200** `err_code 0`, full `data.session` incl. **`chatroom_id: "SPIM-…"`**, status, start/end, member_cnt |
| `GET live.shopee.tw/api/v1/host_session/{host uid}` | 200 `{sid, shop_id, is_seller}` |
| `GET live.shopee.ph/api/v1/host_session?uid=1` (bogus, PH) | 200 `err_code 20009 "data not exists"` — a normal API error, NOT the anti-fraud 403 → same route exists on PH |
| `GET chatroom-live.shopee.tw/api/v1/fetch/chatroom/SPIM-…/message?uuid=…&timestamp=0&version=v2`, 71 polls / 5 min | **all 200 / code 0**, `poll_interval 3`, 70–390 ms each (p50 ≈ 75 ms), 0 messages (see §3), no 429/403, no rate-limit headers |
| same endpoint with a bogus room id, PH and TW, bare User-Agent only | 200 / code 0 (empty room) |

`error 90309999` + `is_login:false` is Shopee's anti-fraud gate; it guards the live LIST and the
per-session metadata endpoint. It does not guard `host_session?uid=` or the chat-room service.

## 3. The live message test (host's own test live, TW, session 8092367, 16:54–16:57 UTC)
`poll.mjs --lives <share link> --minutes 3 --cc tw`, plain Node fetch, one uuid:
- **59 polls / 3 min (19.7 per min), 59 × HTTP 200 / code 0, 0 blocked, 0 errors**; latency
  p50 73 ms, p90 87 ms, max 229 ms (first call 668 ms); `poll_interval` stayed 3.
- **41 comments received — every comment the host typed arrived**, including `mine 1`, `👍3`
  (emoji intact), `hello 2` and a run of numbers; nothing missing or duplicated.
- **Delay:** 1.0–4.0 s between the comment's server timestamp and the poll that carried it
  (median ≈ 2.3 s) — i.e. the 3 s poll interval, nothing more. The very first poll
  (`timestamp=0`) also returned the last comment posted ~6 s before the poller joined.
- An earlier run on the same room (before the parser understood the batch shape) showed the
  same health: 59/59 ok, 8 batches of comments, no errors. The first test live (no comments
  posted during the window) showed 71/71 ok and 0 messages — the feed carries only what is
  posted after the poller joins (plus a few seconds of backlog).
- **Payload shape** (`data.message` = array of batches):
  ```
  data.message[i] = { msgs: [ { id, uid, nickname, display_name, avatar, content, ts, privacy_type } ], timestamp }
  msg.content     = JSON string: {"type":101,"content":"<comment text>","content_v2":…}   (101 = chat text)
  msg.ts          = seconds;  data.timestamp = the cursor to send back
  ```
- Proven overall: share link → `session_id`; `host_session?uid=` → `chatroom_id` (no cookie,
  no token); the chat-room poll works with no cookie, token or signature from a Taiwan IP; the
  server dictates the interval; no block or rate-limit signal across ~190 polls today.
- **Known limit — host uid:** the share link's `share_user_id` is the SHARER's uid, not the host's.
  For **SellerFlow's case this is fine**: the seller is the host and shares their own link (or we
  store the seller's Shopee uid once), so `host_session?uid=` gives their current live every time.
  For an arbitrary third-party live (the "busy public live" test) the only plain route to its
  chat room is the gated `/session/{id}` call → not available without login/anti-fraud tokens,
  and probing other sub-resources for the host id was refused as circumvention → stopped there.
  `host_session` for a uid returns that host's CURRENT or LAST session (`status 1` live / `2` ended).

## 4. Scalability (REST polling, one Render IP, ~50 lives)
- Transport = polling; `poll_interval` 3 s observed → **~20 req/min per live**, ~1,000 req/min
  for 50 lives from one IP, each ~70–100 ms. Never poll below the returned interval.
- Token cost: none — the `uuid` is client-generated; one per live is free.
- Rate-limit signals: none in 71 consecutive polls (+ ~20 bogus-room probes): no 429/403, no
  `Retry-After` / `x-ratelimit-*`, no token expiry, no drops. Concurrent 2–3-live test not yet run
  (needs 2–3 host uids); `poll.mjs --lives a,b,c` does it.
- Honest risk that one IP serving ~50 lives gets throttled: **medium**. The chat service is
  permissive today, but the surrounding stack runs an active anti-fraud gate and 50 pollers behind
  one IP with no browser fingerprint is an unusual pattern. Mitigations: honour `poll_interval`,
  one uuid per live, exponential back-off on any non-200 / code≠0, stop at `status 2`.

## 5. Region / IP
Both `live.shopee.tw`/`.ph` and `chatroom-live.shopee.tw`/`.ph` answered from a Taiwan IP; nothing
suggests a PH IP is required. Render (US) is untested; the `.ph` edge may geo-vary — run
`poll.mjs` from Render before deciding. The method is not IP-sensitive in anything observed.

## 6. Risks
- ToS: Shopee's terms restrict automated access; same class of decision as the TikTok reader.
- Blocking: the anti-fraud gate already covers two neighbouring endpoints; it could be extended
  to `host_session` / `chatroom-live` at any time, which would stop the reader (honest failure).
- Host uid dependence: works only for lives whose host uid we know (the seller's own).

## 7. How it would plug in (if the message test passes)
`server/shopeeLive.js` beside `fbLive.js`: `connect(shareLinkOrUid)` → `resolveSessionId` →
`host_session?uid=` (chatroom_id, status) → per-live poll loop at the server's `poll_interval`
(back-off on errors, stop on `status 2` / `end_time`) → normalize `msgs` → the SAME
`emitCommentScoped` relay (sanitize, msgId dedup) the TikTok reader feeds. The seller's Shopee
uid is captured once from their own share link in Settings.

## Still open
- Chinese text: the planned `我要 2` was not typed in the measured window (emoji and Latin were);
  the payload is plain JSON/UTF-8, so no reason to expect a difference — re-check in the next run.
- The concurrent 2–3-live read from one IP (`poll.mjs --lives a,b,c`) and a run from Render.
- PH: the same routes exist on `live.shopee.ph` / `chatroom-live.shopee.ph` (bogus-uid and
  bogus-room probes answered normally, not the anti-fraud 403) — a PH live has not been read yet.
