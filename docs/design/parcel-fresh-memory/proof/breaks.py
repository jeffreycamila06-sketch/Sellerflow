# On-purpose breaks for sql/193 + sql/194: each one damages a file, runs the PGlite proof
# (scripts/sql193-behaviour.mjs) and the CI test (parcelFreshMemorySql.test.ts), and restores the file.
# A break is CAUGHT when at least one of the two goes red. Run from the repo root:
#   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> python3 docs/design/parcel-fresh-memory/proof/breaks.py
import os, subprocess, sys
F193 = "sql/193_parcel_check_fresh_memory.sql"
FRB = "sql/193_parcel_check_fresh_memory_rollback.sql"
F194 = "sql/194_parcel_check_recheck_old_no.sql"
def nth(s, old, new, n):  # replace the n-th occurrence (1-based) only
    i = -1
    for _ in range(n):
        i = s.index(old, i + 1)
    return s[:i] + new + s[i + len(old):]
BREAKS = [
    ("193: own 'full' asked again every hour (extension only)", F193, lambda s: nth(s, "interval '15 minutes';", "interval '1 hour';", 1)),
    ("193: backup keeps phone ok 6 hours (backup != extension)", F193, lambda s: nth(s, "v_ok_ttl constant interval := interval '5 minutes';", "v_ok_ttl constant interval := interval '6 hours';", 2)),
    ("193: phone restricted copied only 5 min (rule changed)", F193, lambda s: s.replace("and c.restricted_until >= (now() at time zone 'Asia/Taipei')::date)", "and c.checked_at > now() - v_ok_ttl)")),
    ("193: trigger on save keeps no_frozen 30 days", F193, lambda s: s.replace("  v_no_ttl constant interval := interval '5 minutes';", "  v_no_ttl constant interval := interval '30 days';")),
    ("193: frozen per-store gap 10 -> 5 min (timing changed)", F193, lambda s: s.replace("v_floor    constant interval := interval '10 minutes';", "v_floor    constant interval := interval '5 minutes';")),
    ("193: frozen ok copied up to 6 min (extension)", F193, lambda s: nth(s, "  v_ok_ttl   constant interval := interval '5 minutes';", "  v_ok_ttl   constant interval := interval '6 minutes';", 1)),
    ("193: company / not_found still copied 24 h (extension)", F193, lambda s: nth(s, "v_store_fixed_ttl constant interval := interval '5 minutes';", "v_store_fixed_ttl constant interval := interval '24 hours';", 1)),
    ("193: also turns the warm-up switch off (app_settings change)", F193, lambda s: s.replace("\ncommit;\n", "\nupdate public.app_settings set value = 'false' where key = 'frozen_warmup_enabled';\ncommit;\n")),
    ("193: re-ask of 'full' uses the 5-minute copy rule", F193, lambda s: nth(s, "and ps.store_full_at < now() - v_store_recheck_ttl", "and ps.store_full_at < now() - v_store_full_ttl", 2)),
    ("rollback: one character changed inside a function", FRB, lambda s: s.replace("-- per store: a not-exported parcel first", "-- per store: a not exported parcel first", 1)),
    ("rollback: phone ok back to 5 min only", FRB, lambda s: nth(s, "v_ok_ttl constant interval := interval '6 hours';", "v_ok_ttl constant interval := interval '5 minutes';", 1)),
    ("194: store update without the 'not exported' rule", F194, lambda s: nth(s, "   where ps.status <> 'exported'\n     and ps.store_full_status in", "   where true\n     and ps.store_full_status in", 1)),
    ("194: also empties phone restricted", F194, lambda s: s.replace("set store_full_status = null, store_full_at = null", "set store_full_status = null, store_full_at = null, phone_check_status = null")),
    ("194: store answers older than 1 minute (not 5)", F194, lambda s: nth(s, "     and ps.store_full_at < now() - interval '5 minutes'\n     and exists", "     and ps.store_full_at < now() - interval '1 minute'\n     and exists", 1)),
    ("194: frozen update for sellers without the check too", F194, lambda s: nth(s, "     and ps.frozen_store_checked_at < now() - interval '5 minutes'\n     and exists (select 1 from public.parcel_check_access a where a.user_id = ps.user_id and a.enabled);", "     and ps.frozen_store_checked_at < now() - interval '5 minutes';", 1)),
    ("194: also empties store 'full'", F194, lambda s: s.replace("and ps.store_full_status in ('company', 'not_found')", "and ps.store_full_status in ('company', 'not_found', 'full')")),
]
def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).returncode
caught = 0
lines = []
for name, path, fn in BREAKS:
    orig = open(path, encoding="utf-8").read()
    broken = fn(orig)
    assert broken != orig, f"break did not change the file: {name}"
    open(path, "w", encoding="utf-8").write(broken)
    try:
        pg = run("node scripts/sql193-behaviour.mjs")
        vt = run("npx vitest run src/redesign/adapters/__tests__/parcelFreshMemorySql.test.ts")
    finally:
        open(path, "w", encoding="utf-8").write(orig)
    ok = pg != 0 or vt != 0
    caught += ok
    lines.append(f"{'CAUGHT' if ok else 'MISSED'}  {name}  (PGlite proof: {'red' if pg else 'green'}, CI test: {'red' if vt else 'green'})")
    print(lines[-1], flush=True)
lines.append(f"\n{caught} of {len(BREAKS)} on-purpose breaks caught")
print(lines[-1])
open("docs/design/parcel-fresh-memory/proof/breaks.txt", "w", encoding="utf-8").write("\n".join(lines) + "\n")
sys.exit(0 if caught == len(BREAKS) else 1)
