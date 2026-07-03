# Supabase production backup (manual — free tier has no automated backups)

## Run (one line, sa Mac)

```bash
SUPABASE_DB_URL='postgresql://postgres:<PASSWORD>@db.sqeuyuktdpidmlfpqgoc.supabase.co:5432/postgres' ./scripts/backup-supabase.sh
```

Output: `~/Sellerflow-backups/backup_YYYYMMDD.sql` — dated, never overwrites
(same-day rerun gets an `_HHMMSS` suffix).

## Saan kukunin ang URL
Supabase Dashboard → **Project Settings → Database → Connection string (URI)**.
Palitan ang `<PASSWORD>` ng database password. ⚠️ **HUWAG i-commit ang URL/
password kahit saan sa repo.**

- Kung nagta-timeout ang `db.…supabase.co` host (IPv6-only ito), gamitin ang
  **Session pooler** connection string mula sa parehong dialog (IPv4-safe).
- Kung walang `pg_dump`: `brew install libpq && brew link --force libpq`.
- Kung may version-mismatch error ang pg_dump: `brew install postgresql@17`
  at gamitin ang bagong pg_dump.

## Ano ang laman ng backup
- **BUONG `public` schema** — lahat ng tables + data + functions/triggers/RLS
  (kasama ang billing `orders` ledger, `seller_profiles`, `live_session_orders`,
  `shipping_entries`, `raffle_config`, `announcements`, atbp.)
- **`auth.users`** — data-only INSERTs (best-effort; sapat para sa account
  list/recovery reference — hindi ito full auth-schema restore).

## Restore (emergency reference lang)
Bagong/blank database: `psql "$NEW_DB_URL" < backup_YYYYMMDD.sql`
Sa totoong disaster, dumaan muna sa Supabase support / bagong project —
huwag i-psql pabalik sa live prod nang walang plano.
