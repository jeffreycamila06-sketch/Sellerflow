#!/usr/bin/env bash
# Sellerflow — production Supabase backup (free tier = NO automated backups).
#
# Dumps the FULL public schema (tables + data + functions/triggers/RLS) plus the auth.users rows
# (data-only INSERTs), gzip-compressed, verified, into:
#   ~/Sellerflow-backups/backup_YYYYMMDD_HHMM.sql.gz   (file 600, folder 700)
# Keeps the newest 14 of those (older ones are deleted only after a NEW backup verified OK).
# One line per run in ~/Sellerflow-backups/backup.log (time, ok/failed, size, duration — never
# the URL). On success it also writes public.app_settings 'db_backup_last_ok' = '<ISO time>|<bytes>'
# so the last good backup can be checked remotely (a failed write there does not fail the backup).
#
# Connection URL: SUPABASE_DB_URL if set, otherwise the macOS Keychain item
# (service "sfl-db-backup"). Never commit it, never put it in a plist or a log.
#
# Manual run:     ./scripts/backup-supabase.sh               (always runs)
#   or            SUPABASE_DB_URL='postgresql://…' ./scripts/backup-supabase.sh
# Nightly agent:  ./scripts/backup-supabase.sh --if-due      (skips if the last OK backup is
#                                                             younger than 20 hours)
# Needs pg_dump/psql 17 or newer (brew install libpq). See scripts/BACKUP-README.md.
set -euo pipefail
umask 077

OUT_DIR="${SFL_BACKUP_DIR:-$HOME/Sellerflow-backups}"
LOG="$OUT_DIR/backup.log"
KEEP="${SFL_BACKUP_KEEP:-14}"
MIN_BYTES="${SFL_BACKUP_MIN_BYTES:-5000000}"   # floor for the compressed file (see README)
KEYCHAIN_SERVICE="${SFL_KEYCHAIN_SERVICE:-sfl-db-backup}"
DUE_HOURS=20
# launchd starts jobs with a minimal PATH: add the Homebrew PostgreSQL client locations.
export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/opt/postgresql@18/bin:/usr/local/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
START_EPOCH="$(date +%s)"

log_line() { # status, size, extra
  printf '%s %s size=%s duration=%ss%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" "$2" "$(( $(date +%s) - START_EPOCH ))" "${3:+ $3}" >> "$LOG"
  chmod 600 "$LOG"
}
# Never let a connection string reach the terminal or a log.
redact() { sed -E 's#postgres(ql)?://[^[:space:]]+#postgresql://[redacted]#g'; }
fail() { echo "BACKUP FAILED: $1" >&2; log_line failed 0 "reason=$1"; exit 1; }

# --if-due (nightly agent): skip when the newest verified backup is younger than DUE_HOURS.
if [ "${1:-}" = "--if-due" ]; then
  NEWEST="$(ls -t "$OUT_DIR"/backup_????????_????*.sql.gz 2>/dev/null | head -1 || true)"
  if [ -n "$NEWEST" ]; then
    AGE_H=$(( ( $(date +%s) - $(stat -f %m "$NEWEST") ) / 3600 ))
    if [ "$AGE_H" -lt "$DUE_HOURS" ]; then
      log_line skipped 0 "reason=last_ok_${AGE_H}h_ago"
      exit 0
    fi
  fi
fi

# ── tools ──
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump_not_found(brew install libpq)"
PG_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
[ "${PG_MAJOR:-0}" -ge 17 ] 2>/dev/null || fail "pg_dump_${PG_MAJOR:-unknown}_too_old_need_17+"
command -v psql >/dev/null 2>&1 || echo "note: psql not found — the app_settings status write will be skipped" >&2

# ── connection URL (env, else Keychain) — never printed ──
DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  DB_URL="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
fi
[ -n "$DB_URL" ] || fail "no_db_url(set_SUPABASE_DB_URL_or_keychain_${KEYCHAIN_SERVICE})"

# ── dump ──
STAMP="$(date +%Y%m%d_%H%M)"
FINAL="$OUT_DIR/backup_${STAMP}.sql.gz"
N=1
while [ -e "$FINAL" ]; do FINAL="$OUT_DIR/backup_${STAMP}_${N}.sql.gz"; N=$((N + 1)); done   # never overwrite
TMP="$OUT_DIR/.inprogress_${STAMP}.sql.gz"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

echo "→ Dumping public schema + auth.users (pg_dump $PG_MAJOR)…"
# Each step is chained: a failure of EITHER pg_dump fails the whole group (and, with pipefail,
# the pipeline) — a group's status alone would only be its LAST command's.
if ! {
  pg_dump --dbname="$DB_URL" --schema=public --no-owner --no-privileges &&
  echo "" &&
  echo "-- ─────────────────────────────────────────────────────────────" &&
  echo "-- auth.users (data-only INSERTs, appended by backup-supabase.sh)" &&
  echo "-- ─────────────────────────────────────────────────────────────" &&
  pg_dump --dbname="$DB_URL" --data-only --column-inserts --table=auth.users
} 2>"$ERR" | gzip -9 > "$TMP"; then
  redact < "$ERR" | tail -3 >&2
  fail "pg_dump_error"
fi
chmod 600 "$TMP"

# ── verify (any failing check = the run failed) ──
gzip -t "$TMP" 2>/dev/null || fail "gzip_test"
BYTES="$(stat -f %z "$TMP")"
[ "$BYTES" -ge "$MIN_BYTES" ] || fail "too_small_${BYTES}_below_${MIN_BYTES}"
CHECKS="$(gzip -dc "$TMP" | awk '
  /^CREATE TABLE public\.seller_profiles \(/ { s = 1 }
  /^CREATE TABLE public\.orders \(/ { o = 1 }
  /^CREATE TABLE public\.live_session_orders \(/ { l = 1 }
  /^-- auth\.users \(data-only INSERTs, appended by backup-supabase\.sh\)/ { h = 1 }
  /^INSERT INTO auth\.users / { u++ }
  /^-- PostgreSQL database dump complete$/ { c++ }
  END { printf "seller_profiles=%d orders=%d live_session_orders=%d auth_header=%d auth_users_rows=%d dumps_complete=%d", s, o, l, h, u, c }')"
echo "  checks: $CHECKS"
case "$CHECKS" in
  *seller_profiles=1*orders=1*live_session_orders=1*auth_header=1*) ;;
  *) fail "content_check($(echo "$CHECKS" | tr ' ' ','))" ;;
esac
case "$CHECKS" in *auth_users_rows=0\ *) fail "auth_users_empty" ;; esac
# Completeness: pg_dump writes "-- PostgreSQL database dump complete" as its LAST line, so each of
# the two dumps must have finished: exactly 2 such lines.
case "$CHECKS" in *dumps_complete=2) ;; *) fail "incomplete_dump($(echo "$CHECKS" | sed -E 's/.*(dumps_complete=[0-9]+).*/\1/'))" ;; esac

mv "$TMP" "$FINAL"
chmod 600 "$FINAL"
DONE_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── retention: newest $KEEP nightly-format files (only after this verified success) ──
ls -t "$OUT_DIR"/backup_????????_????*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r OLD; do rm -f "$OLD"; done

# ── remote status (best effort) ──
STATUS="status_write=skipped"
if command -v psql >/dev/null 2>&1; then
  if printf '%s\n' "insert into public.app_settings (key, value, updated_at) values ('db_backup_last_ok', :'v', now()) on conflict (key) do update set value = excluded.value, updated_at = now();" \
      | psql --dbname="$DB_URL" -X -q -v ON_ERROR_STOP=1 -v v="${DONE_ISO}|${BYTES}" >/dev/null 2>"$ERR"; then
    STATUS="status_write=ok"
  else
    STATUS="status_write=failed"
    redact < "$ERR" | tail -2 >&2
  fi
fi

log_line ok "$BYTES" "file=$(basename "$FINAL") $STATUS"
echo "✅ Backup OK: $FINAL ($BYTES bytes) — $CHECKS — $STATUS"
