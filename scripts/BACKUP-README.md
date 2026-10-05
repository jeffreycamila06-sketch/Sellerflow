# Supabase production backup — nightly on this Mac (free tier has no automated backups)

⚠️ **The backup files hold personal data** (seller profiles, buyer names/handles, orders,
auth.users emails). They must **stay on this Mac** — never upload them, email them, or copy
them into the repo (`.gitignore` blocks `Sellerflow-backups/` and `backup_*.sql`).

## How the nightly job works
- `scripts/backup-supabase.sh` dumps the **whole `public` schema** (tables, data, functions,
  triggers, RLS) plus the **`auth.users` rows** (data-only INSERTs), gzip-compressed.
- A launchd user agent (`~/Library/LaunchAgents/com.sellerflow.dbbackup.plist`, template in
  `scripts/com.sellerflow.dbbackup.plist`) runs it **every day at 05:30** (Mac local time =
  Asia/Taipei), and once more at login. It runs with `--if-due`, which skips when the newest good
  backup is younger than 20 hours — so a missed night is caught up at the next wake or login.
  `caffeinate -i` keeps the Mac awake while it runs.
- Every run is **verified**; any failing check = the run failed and the old files stay:
  `gzip -t` passes · size ≥ 5 MB (`SFL_BACKUP_MIN_BYTES`) · contains `CREATE TABLE` for
  `seller_profiles`, `orders`, `live_session_orders` · the `auth.users` section with at least one row.
- The **newest 14** backups are kept; older ones are deleted only after a new backup passed.
- Needs `pg_dump`/`psql` **17 or newer** (`brew install libpq`); an older pg_dump stops the run.

## Where the files are
- `~/Sellerflow-backups/backup_YYYYMMDD_HHMM.sql.gz` (folder mode 700, files mode 600)
- `~/Sellerflow-backups/backup.log` — one line per run: time, `ok`/`failed`/`skipped`, size, duration
  (never the database URL)
- `~/Sellerflow-backups/launchd.out.log` / `launchd.err.log` — the agent's console output

## The database URL (Keychain — never in the repo, a plist, a log or shell history)
Supabase → Project Settings → Database → Connection string → **Session pooler** URI (IPv4).
Store it once (Terminal asks for it without showing it):
```bash
security add-generic-password -a "$USER" -s sfl-db-backup -U -w
```
The script reads `SUPABASE_DB_URL` if set, otherwise this Keychain item.

## Commands
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sellerflow.dbbackup.plist   # load
launchctl bootout gui/$(id -u)/com.sellerflow.dbbackup                                  # unload
launchctl kickstart gui/$(id -u)/com.sellerflow.dbbackup                                # run now (--if-due)
./scripts/backup-supabase.sh                                                            # manual run (always)
tail -5 ~/Sellerflow-backups/backup.log                                                 # last runs
```

## Checking the last backup remotely (e.g. from a phone)
On success the script writes `public.app_settings` key `db_backup_last_ok` =
`<ISO time UTC>|<bytes>` (best effort — a failed write does not fail the backup; it is logged as
`status_write=failed`). Check it in Supabase → SQL editor:
`select value, updated_at from app_settings where key = 'db_backup_last_ok';`
Any signed-in seller can read app_settings (RLS select policy), so this value holds no secret.

## The Mac must be awake and logged in
- A sleeping Mac does not run the 05:30 job until it wakes. Keep it plugged in and either turn
  idle sleep off (`sudo pmset -c sleep 0`) or add a daily wake shortly before the job
  (`sudo pmset repeat wakeorpoweron MTWRFSU 05:25:00`).
- After a restart **nobody is logged in**: user agents do not run and the login keychain is
  locked (FileVault is on, so there is no automatic login). Backups resume at the next login.
  `sudo pmset -a autorestart 1` restarts the Mac after a power cut, but it still needs a login.

## Restore (never into production)
1. Fresh database (a new Supabase project, or a local PostgreSQL 17 test database).
2. `gunzip -c ~/Sellerflow-backups/backup_YYYYMMDD_HHMM.sql.gz | psql "$NEW_DB_URL"`
   The `auth.users` INSERTs at the end need an `auth` schema (a Supabase project has one); on a
   plain PostgreSQL they fail and the public schema still restores.
3. In a real disaster, go through Supabase support / a new project first — never psql back into
   the live production database without a plan.
