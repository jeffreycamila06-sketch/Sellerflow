# 7-11 server backup — keep the E-Map session ready on standby (2026-11-20)

## Why
Until now the server's E-Map store-search session stayed alive only because the **shadow** pass re-checked about
1,200 parcels a day. With the shadow switch (`pc711_shadow_enabled`) OFF nothing touched it while the backup was a
follower, so when the Lenovo stopped, the backup's store checks started on a dead session (minutes of failed tries,
parcels written "unknown" first). Phone checks were never affected (they need no session).

## What it does now (`server/pc711Shadow.js` `standbyKeep`, web: the Admin card)
While the shadow switch is OFF, the backup switch is `'true'` and the backup is a follower (the Lenovo is checking):
- **no parcel check at all** — no store, phone or frozen check, no write;
- only what the extension's standby does (`chrome-extension/background.js` `pcRunOnce`): `pick` · the keepalive on
  store 198002 every 5 min · the repair (a GET of the E-Map page after 3 misses over 2 min);
- plus Jeff's rule (the extension leaves this to its leader): **open** a session when there is none — at once, one more
  try right away to confirm, then one every 2 min; at once after a new 7-11 login;
- **01:00–05:00 Taipei:** the keepalive runs, a miss is not counted, no repair, no open (the extension's night rules);
- **no safety brake** (like on duty); the open schedule keeps a failing open to about 5 requests every 2 min;
- **a lost 7-11 login:** the same rule as today — standby goes on only while the kept session still answers; with no
  session nothing is sent until the next login (then it opens at once). Login handling and the Telegram alert unchanged.
- **Shadow ON** and **on duty**: exactly as before (proved request-for-request below).
- Log: `[PC711_STANDBY] on` / `off` once per change + the existing `[PC711_EMAP] keepalive verdict=… alive=… http=… ms=…`
  (words and numbers only).

**Admin card** (Admin → 7-11 Login → Who is checking), one line while the backup is on:
**Store session: ready** (green — answered in the last 6 min, last try did not fail) · **opening** (orange — not ready,
but the login is fine and it is outside 01:00–05:00, so the server is repairing / opening it) · **not ready** (red —
anything else, e.g. logged out with no session, or 01:00–05:00 with no session). Pictures: `shots/` (360 / 390 / 430 /
1280 px, no sideways scroll, no cut text — `shots.txt`). The word comes from server memory (`GET /admin/pc711/duty`,
`storeSession`); nothing is read or sent to make it.

## Proof (`src/redesign/adapters/__tests__/pc711Standby.server.test.ts`)
The REAL checker loop, backup job and kept E-Map session on a fake 7-11 whose session dies after **20 idle minutes**
(an assumption — the real idle limit was never measured), a fake lease/database (the sql/179 rules) and a virtual clock.
**Main** = a frozen copy of main's `pc711Shadow.js` (`fixtures/pc711Shadow.main.js`).

### The Lenovo stops after the shadow was OFF (shadow ON 10 min first, so a session existed)
| Shadow off for | Parcels waiting | Main: first real store answer after the stop | Main: "unknown" written | **Branch: first real store answer** | **Branch: "unknown"** | Branch: open needed |
|---|---|---|---|---|---|---|
| 10 min | 1 | 122 s | 0 | **123 s** | **0** | no |
| 10 min | 2 | 122 s | 0 | **123 s** | **0** | no |
| 10 min | 3 | 122 s | 0 | **123 s** | **0** | no |
| 60 min | 1 | 682 s | 1 | **123 s** | **0** | no |
| 60 min | 2 | 376 s | 2 | **123 s** | **0** | no |
| 60 min | 3 | 256 s | 0 | **123 s** | **0** | no |

The take-over itself needs 120 s of silence (the database's rule); the branch answers in the take-over pass, on the
kept session (no open step). Re-run: `SFL_STANDBY_TABLE=<file> npx vitest run src/redesign/adapters/__tests__/pc711Standby.server.test.ts`.

### Same requests as main
- Shadow ON (backup on, and backup off): over 3 hours with store / phone / frozen parcels, a 7-11 session reset, a lost and
  returned login, a take-over and the hand-back → **the same requests at the same times** as main, the same writes.
- On duty (shadow OFF, the Lenovo silent from the start) → the same requests and writes as main until the hand-back.
- The only difference: shadow OFF + backup on + follower — main sends nothing, the branch keeps the session.

### Requests per simulated day (standby only, 00:00 → 24:00 Taipei, the session never dies)
| | per day |
|---|---|
| keepalive (store 198002, 1 request each) | 288 |
| open | 1 |
| repair GET / store / frozen / phone / shadow checks | 0 |
| **total** | **289** |

Plus, outside this simulation and unchanged: the hourly 賣貨便 login check (~20 a day) and an open (4 requests) only
when 7-11 ends the session. Today with the shadow ON: about 3,800–4,100 7-11 requests a day (pc711_shadow, Nov 20).

### On-purpose breaks — `proof/breaks.txt`: 11 of 11 caught.

## Deploy
Server code → **Render deploy needed** (manual, or the nightly window). After it is live, turn
`pc711_shadow_enabled` OFF (Jeff). Nothing in `app_settings` is changed by this branch; no SQL; extension unchanged.
