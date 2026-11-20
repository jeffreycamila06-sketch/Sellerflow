# Shopee Live — why only the seller's own comments arrive (diagnostic, 2026-11-20)

Symptom: with the share-link reader (`server/shopeeLiveLink.js`) only the seller's own comments have ever arrived — two
PH beta sellers, every live so far. The poller works (her text arrives). Two possible causes:
**A** — viewer messages arrive but our parsing drops them; **B** — the chat-room endpoint never returns other
viewers' messages to a reader that is not logged in.

## STEP 0 — every place a message can be lost (main `5177fd13`)

| # | Where (file:line on main) | What drops it | Explains |
|---|---|---|---|
| 1 | `shopeeLiveLink.js:67` `parseChatBatches` | Only the `message` and `e2e_message` lists are read. `system` (always present in the reply) and any other list are never read. | A (if viewer comments live in another list) |
| 2 | `shopeeLiveLink.js:69-71` | A list that is not an array of `{msgs:[…]}` / an array / a non-empty object (e.g. messages under another key such as `list`) gives nothing. | A |
| 3 | `shopeeLiveLink.js:72` | A message that is not an object is skipped. | A (unlikely) |
| 4 | `shopeeLiveLink.js:85` `commentTextOf` | Content JSON with a `type` other than 101 → no text. | A (if viewer chat used another type) |
| 5 | `shopeeLiveLink.js:86` | Content JSON with type 101 but no string `content` / `text` (e.g. only `content_v2`, or a rich object) → no text. | A |
| 6 | `shopeeLiveLink.js:84` | Content missing, a number, an array → no text. | A |
| 7 | `shopeeLiveLink.js:94` `shopeeToPayload` | No text → `null` → skipped (`pollOnce` line 205). | A (the result of 4–6) |
| 8 | `shopeeLiveLink.js:97` + `:206` dedupe | Key = `id`, else `msg_id`, else `uid-ts`. A number 0 counts as an id ("0"), so two messages that both carry `id: 0` (or any shared id) — the second is dropped as a repeat. | A (a key collision) |
| 9 | `shopeeLiveLink.js:189` cursor | `timestamp=<cursor>` from the last reply. A skip here would hit the host's messages too. | Not a fit (host text arrives) |
| 10 | `shopeeLiveLink.js:201,209` first poll | The first poll's messages are marked `initial` (display-only "Earlier comments", not orderable). Only the first poll. | Not a fit (every live, all day) |
| 11 | `server.js:560` `emitCommentScoped` + client `useLiveFeed.ts:419-460` | Scoping by seller / browser session / selected shop and `commentKey` (platform + shop + session + handle + time + text). Same for every sender — no rule looks at who wrote it. | Not a fit |
| — | The request itself (`shopeeLiveLink.js:189`, headers `:135`) | No login, no cookie, only `user-agent` + `accept`. The research probe also sent `client-info` and `x-livestreaming-source: shopee` (as the viewer page does); production does not. | **B** — the server may answer an anonymous reader with the host's messages only (or with these headers missing). The code cannot tell; only the live counts can. |

**Research notes in the repo:** none on `main` — the probe lives only on branch `claude/shopee-probe`
(`scripts/probes/shopee/FINDINGS.md`, commit `9d69ca54`, 2026-10-27, TW). It proved the share link → `host_session?uid=`
→ chatroom → message poll path with no login, and "41 comments received — every comment **the host** typed arrived".
**It never tested a second viewer.** Its message shape: `data.message = [{ msgs: [{ id, uid, nickname, display_name,
avatar, content, ts, privacy_type }], timestamp }]`, `content` = JSON string `{"type":101,"content":…,"content_v2":…}`;
the reply also has `e2e_message` and `system` (seen empty). `privacy_type` was 0 on the host's messages — its meaning
for viewers is unknown.

## The diagnostic (log only)
`server/shopeeDiag.js`, wired into `pollOnce` / `stopPoller`. One line per poller every 60 s, one at once when a new
message shape is seen (≤ 10 per poller), and one when the poller stops. Counts are since the poller started.

```
[SHOPEE-DIAG] seller=<id> polls=<n> msgs_message=<n> msgs_e2e=<n> msgs_system=<n> types=101:n,7:n content=json:n,string:n,object:n,other:n
  from_host=<n> from_others=<n> from_nouid=<n> kept=<n> dropped_notext=<n> dropped_dupe=<n> dupe_collide=<n> keys_unknown=<names|->
```
(one line in the log). Added beyond the requested fields: `msgs_system` (the list the reader never reads),
`from_nouid` (a message with no uid is not counted as "others"), `dupe_collide` (a repeat whose id was first seen on a
DIFFERENT message — the key-collision case, row 8).

**How to read it after a live where viewers commented:**
- `from_others = 0`, `msgs_system = 0` → **B**: the endpoint does not send other viewers' messages to our reader.
- `from_others > 0` and `kept` about equals them → they arrive and are relayed; the loss is after the server.
- `dropped_notext` grows with `from_others`, or `types` shows another number → **A** (rows 4–7).
- `dupe_collide > 0` → **A** (row 8).
- `msgs_system` grows while viewers comment, `from_others = 0` → viewer comments may be in the `system` list (row 1).
- `keys_unknown` ≠ `-` → a field we do not know (names only).

Never in the line: comment text, names, usernames, uids, avatars, links, chatroom ids, tokens. Field names are cut to
≤ 24 letters/digits/_ with no 4+ digit run; an object with more than 12 unknown field names (a map keyed by ids or
names) is logged as `many:<n>` only. `seller=` is the same id the existing `[SHOPEE-LINK]` lines already print.

## Proof
`src/redesign/adapters/__tests__/shopeeDiag.server.test.ts` (18 tests):
- the walk = the reader's walk (same objects, same order) for 8 list shapes;
- the counters through the REAL reader: message vs e2e vs system, type 101 vs other, host vs others vs no uid, repeats
  vs same-id collisions, no text, unknown names;
- when lines are written (new shape at once, 60 s, stop, failing polls) and that no private value appears;
- **with the diagnostic on, the reader emits exactly what main's reader emits** — every payload field, every status,
  every request, every answer and every other log line — against a frozen copy of main's file
  (`fixtures/shopeeLiveLink.main.js`); `diag: false` = main line for line; a throw inside the diagnostic changes nothing.
- `proof/breaks.txt`: 15 of 15 on-purpose breaks caught.

**Deploy:** server code → Render deploy. Then ask the beta seller to go live and have a second phone comment; read the
`[SHOPEE-DIAG]` lines in Render.
