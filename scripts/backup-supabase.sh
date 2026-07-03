#!/usr/bin/env bash
# Sellerflow — production Supabase backup (free tier = NO automated backups).
#
# Dumps the FULL public schema (tables + data + functions/triggers/RLS) and,
# best-effort, the auth.users rows (data-only INSERTs — enough to recover the
# account list; full auth restore goes through Supabase support anyway).
#
# Output: ~/Sellerflow-backups/backup_YYYYMMDD.sql
#   Dated files, NEVER overwrites — a same-day rerun gets an _HHMMSS suffix.
#
# Run (Mac):
#   SUPABASE_DB_URL='postgresql://postgres:<PASSWORD>@db.sqeuyuktdpidmlfpqgoc.supabase.co:5432/postgres' ./scripts/backup-supabase.sh
#
# Get the URL: Supabase Dashboard → Project Settings → Database →
# Connection string (URI). If the direct db.… host times out on your network
# (it is IPv6-only), use the "Session pooler" connection string instead —
# same dialog, IPv4-safe. NEVER commit the URL/password to the repo.
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "ERROR: SUPABASE_DB_URL is not set."
  echo "  Get it: Supabase Dashboard → Project Settings → Database → Connection string (URI)"
  echo "  Run:    SUPABASE_DB_URL='postgresql://…' $0"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found."
  echo "  Mac: brew install libpq && brew link --force libpq"
  exit 1
fi

OUT_DIR="$HOME/Sellerflow-backups"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d)"
OUT="$OUT_DIR/backup_${STAMP}.sql"
# Never overwrite: same-day rerun → time-suffixed file.
if [ -e "$OUT" ]; then
  OUT="$OUT_DIR/backup_${STAMP}_$(date +%H%M%S).sql"
fi

echo "→ Dumping public schema (tables + data + functions/RLS)…"
pg_dump "$DB_URL" --schema=public --no-owner --no-privileges > "$OUT"

echo "→ Dumping auth.users (best-effort, data only)…"
TMP="$(mktemp)"
if pg_dump "$DB_URL" --data-only --column-inserts --table=auth.users > "$TMP" 2>/dev/null; then
  {
    echo ""
    echo "-- ─────────────────────────────────────────────────────────────"
    echo "-- auth.users (data-only INSERTs, appended by backup-supabase.sh)"
    echo "-- ─────────────────────────────────────────────────────────────"
    cat "$TMP"
  } >> "$OUT"
else
  echo "⚠️  auth.users dump failed (role permissions) — the public-schema backup above is still complete."
fi
rm -f "$TMP"

SIZE="$(du -h "$OUT" | cut -f1)"
TABLES="$(grep -c '^CREATE TABLE' "$OUT" || true)"
echo "✅ Backup done: $OUT ($SIZE, $TABLES tables)"
