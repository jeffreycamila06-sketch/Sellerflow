# Telegram alert from the DATABASE when nobody is checking parcels (sql/195, Nov 21 2026)

Jeff's decision: option A — Supabase itself sends the alert, independent of Render and the Lenovo, so it also
covers "the Lenovo AND the server are both dead". It replaces the Claude scheduled task "SFL parcel checker silence
alert" (chat-Claude turns that off after Jeff's test). **NOT APPLIED.** No server, Render, extension, app or
app_settings change.

## How it sends: the `http` extension, not pg_net (decided 2026-11-21)
The plan was pg_net with "revoke the net tables from anon/authenticated". That cannot be done on this project:
- pg_net 0.20.0's own install script ends with `grant all on all tables in schema net to PUBLIC` — the queue
  (`net.http_request_queue`, which holds the request address = the bot token until it is sent) and the replies
  (`net._http_response`) would be open to every role, anon and authenticated included.
- On this project supautils creates privileged extensions (pg_net, http, pg_cron …) as `supabase_admin`
  (`supautils.privileged_extensions_superuser`); pg_cron, created the same way, is owned by supabase_admin.
  `postgres` is not a superuser, and a role can only revoke grants it made itself → the revoke would do nothing.
- So Jeff chose the **http extension (pgsql-http 1.6)**: ONE synchronous HTTPS request inside the run. The address
  with the token exists only in that request — no table, no log row, no state row, no return value, no notice.
  Supabase's default privileges in schema `extensions` give `postgres` EXECUTE on the new functions (checked on
  production: `postgres=X*/supabase_admin`, e.g. pg_trgm's functions).

## The rule (every 10 minutes, at :03 :13 :23 …)
- **Waiting:** parcels of sellers with the check that are not exported, still miss a phone or store answer, and
  were saved 30 minutes to 2 days ago — the same parcels the checker's queue (`admin_parcel_checks_pending`) hands
  out (including its shop-pool condition).
- **Answer:** the newest store answer (`store_check_log`), phone answer (`parcel_scans.phone_check_at`) or frozen
  answer from a checker (`store_frozen_check_log`, live / cache / warmup — not the copy on save).
- **Alert** when parcels wait and no answer came in 30 minutes, never 01:00–05:00 Taipei. Repeat at most once per
  60 minutes. **"Back"** only after a real answer that came after the alert, and only if an alert of that episode
  reached Telegram. A failed send is sent again at the next runs, up to 3 tries, ending " (sent again)"
  (timeouts, connection errors, HTTP 429 / 5xx; a 4xx such as a wrong token is not retried).
- Replay of the last 14 days (STEP 0): 1 episode (Nov 15, 11:30–12:57, 7 parcels of 2 sellers) → 3 messages in 14 days.

Messages (counts and times only):
- `⚠️ Walang nagche-check ng parcel nang 45 min — 3 parcels naghihintay (2 sellers). Tingnan ang Lenovo at ang server.`
- `✅ May nagche-check na ulit.`
- Test: `SellerFlowLive test alert (database). Alerts are working.`

## Steps for Jeff (in this order)
1. chat-Claude applies `sql/195_parcel_silence_alert.sql`.
2. Run `docs/ops/db-silence-alert-check.sql` (read only) — every row ok, except "Vault secret names present" =
   `none` until step 3. It also proves anon / authenticated cannot read `net.http_request_queue` /
   `net._http_response`: they do not exist (pg_net is not installed).
3. Jeff creates the two Vault secrets himself, with the SAME values as Render's `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID` — Dashboard → Project Settings → Vault → "Add new secret", names exactly
   `telegram_bot_token` and `telegram_chat_id`. (Or in the SQL editor:
   `select vault.create_secret('<the token>', 'telegram_bot_token');` and
   `select vault.create_secret('<the chat id>', 'telegram_chat_id');` — typed by Jeff; nobody else sees them.)
4. Run the check again → the Vault row is ok.
5. Test in the SQL editor: `select public.admin_parcel_silence_test();` → `sent`, and the test message arrives in
   Telegram. Other answers: `no_secrets` / `bad_secrets` (names or values), `http_401` (wrong token), `http_400`
   (wrong chat id), `timeout`, `net_error`, `too_soon` (one test a minute).
6. chat-Claude turns off the Claude scheduled task.

**Off:** `select cron.unschedule('parcel-silence-alert');` — or delete the two Vault secrets.
**Rollback:** `sql/195_parcel_silence_alert_rollback.sql` (job, functions, tables, http extension; the Vault secrets stay).

## Proof
- `scripts/sql195-behaviour.mjs` (PGlite, **202 checks**) — output `proof/sql195-behaviour.txt`: install with
  Supabase's default grants already in place; every rule above; every send failure; the test function as SQL
  editor / app admin / non-admin / anon; the token and chat id found ONLY in the send requests — never in a log row,
  the state row, the cron job, a return value or a notice, even when the stand-in http raises errors that contain the
  whole address; the post-apply check query runs and passes on the model; applying twice; the rollback.
- `src/redesign/adapters/__tests__/parcelSilenceSql.test.ts` (CI, 16 tests) — text pins, incl. the token used in ONE
  expression and the server's own token / chat-id shapes.
- `proof/breaks.py` → `proof/breaks.txt` — on-purpose breaks, each caught.

## Known
- PGlite has no real http extension, Vault or pg_cron: stand-ins with the same names and types. The real request,
  Vault decryption and pg_cron's `3-59/10` schedule are proven by step 2 + step 5 on production.
- A run that sends waits up to 20 s for Telegram (synchronous). Quiet runs make no request, only small indexed reads.
- Telegram delivered but answered after 20 s → counted as a timeout → sent again at the next run, marked
  " (sent again)" (the server's alerts have the same limit).
- anon / authenticated keep Supabase's default EXECUTE on `extensions.http` (PUBLIC, granted by supabase_admin —
  postgres cannot take it back either). It is not reachable through the app's API as long as `extensions` is not an
  exposed schema (Supabase default: public + graphql_public) — worth a look in Dashboard → API settings.
- If the multi-seller check is switched off (`parcel_check_multi_enabled`) or the sender phone is paused, the queue
  is empty, parcels wait and the alert fires — that is "nobody is checking". Silence it with the off switch above.
- Anyone logged in to the database as `postgres` can run the test (they can already do everything).
