# Server alarms on Telegram (memory, restart, database connections)

Sent to the same Telegram chat as the other Admin alerts. Numbers only — never a seller's name, email or id.

## The messages

| Message | When | What to do |
|---|---|---|
| ⚠️ SellerFlowLive server … `sumisikip na` | Memory at 60 % of the limit or more for 2 minutes | Nothing yet. Watch for the next one. |
| 🔴 … DELIKADO | Memory at 75 % or more for 2 minutes | Raise the plan on Render before it fills up. |
| ✅ … ok na ulit | Memory under 55 % for 15 minutes, after a warning you received | Nothing. |
| 🔴 … NAG-RESTART | The server started again and the run before it did not end cleanly (crash, or killed for memory) | Sellers who were live must tap Connect again. If the last line says a high memory %, raise the plan. |
| ⚠️ SellerFlowLive database … | Database connections at 70 % of the limit or more for 5–10 minutes | Tell Claude. |
| ✅ SellerFlowLive database — ok na ulit | Under 60 % for 15 minutes, after a warning you received | Nothing. |

One message per change. Going from DELIKADO back down to the warning level sends nothing; you get ✅ only
when it is really back to normal.

## No alarm for these (on purpose)

A deploy, the nightly deploy, Render's own restart: Render asks the server to stop, the server notes "ended
cleanly", and the next start stays silent.

Second safety (2026-11-26): on a planned restart Render starts the new server BEFORE it stops the old one, so
for a minute or two both are up. If the old server's last heartbeat is AFTER the new server started, it is a
planned restart even when the old one never noted "ended cleanly" — the new server marks it clean (clean end =
that last heartbeat) and sends nothing. After a real crash the new server can only start once the old one is
gone, so its last heartbeat is BEFORE the new start: that still sends NAG-RESTART.

### Did the stop reach the server? (Render logs, at any restart)

```
[SHUTDOWN] SIGTERM at …            ← the server got Render's stop
[CAPACITY] clean end written=true ms=…   ← and noted "ended cleanly" in the database
```

Both lines there = all good. NEITHER line at a restart = Render's stop is not reaching the server (it happened
on Nov 25–26: with the Start Command `npm start`, npm got the stop and a shell in between dropped it — the
`start` script is now `exec node server.js`, which removes that shell). If the lines are still missing after
the deploy: Render → the service → Settings → Start Command → set it to `node server.js`.

## Turn them off / on (no deploy)

```sql
update public.app_settings set value = 'false' where key = 'server_alarms_enabled';  -- off
update public.app_settings set value = 'true'  where key = 'server_alarms_enabled';  -- on
```

Off takes up to a minute for the server and up to 5 minutes for the database alarm.
They are also off while `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` are not set on Render.

## The memory limit

The server reads it by itself, in this order: Render env `MEMORY_LIMIT_MB` (if you set it) → the limit the
machine reports → 512. After a plan change on Render nothing needs editing. To check what it uses, look in the
Render log right after a start:

```
[CAPACITY] memory limit=512MB source=container
```

If that number is not your plan's memory, set `MEMORY_LIMIT_MB` on Render to the right number (for example `2048`).

## Look at the state

```sql
-- the last runs of the server: when each started, its last heartbeat, lives, memory %, clean end or not
select started_at, heartbeat_at, lives, mem_pct, told_level, ended_clean_at, alarmed_at
  from public.server_runs order by started_at desc limit 10;

-- the database-connections alarm
select level, streak, told, last_used, last_max, last_result, updated_at from public.db_capacity_state;
```

## What it cannot tell

- A crash and a kill for memory look the same (no clean end). The last line of the restart message gives the
  memory % of the last heartbeat as a hint.
- If Render stops the server because it thinks it is unhealthy, that is a clean stop: no alarm.
- A server that crashes during the minute or two when the new one is already up (a planned restart in
  progress) is counted as that planned restart: no alarm.
- If the server does not come back at all, nothing can be sent from it.
- The restart alarm arrives about 2–3 minutes after the new start (it waits to be sure the old one is gone).
- The database alarm counts connections inside Postgres. It does not see clients waiting at Supabase's pooler.
