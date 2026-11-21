#!/usr/bin/env python3
# On-purpose breaks: each one undoes ONE rule of sql/195, runs the PGlite proof (scripts/sql195-behaviour.mjs) and the
# CI text pins (parcelSilenceSql.test.ts), and puts the file back. A break that leaves both green = that rule is untested.
#   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> python3 docs/design/db-silence-alert/proof/breaks.py
import os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).with_name("breaks.txt")
F = ROOT / "sql/195_parcel_silence_alert.sql"
PIN = ["npx", "vitest", "run", "src/redesign/adapters/__tests__/parcelSilenceSql.test.ts"]
PGL = ["node", "scripts/sql195-behaviour.mjs"]

BREAKS = [
    ("the send prints the address in a notice", "  if to_regprocedure('extensions.http(extensions.http_request)') is null then return 'http_missing'; end if;\n",
     "  if to_regprocedure('extensions.http(extensions.http_request)') is null then return 'http_missing'; end if;\n  raise notice 'to %', 'https://api.telegram.org/bot' || v_token;\n"),
    ("a success word carries the chat id", "return case when v_ok then 'sent' else 'not_ok' end;", "return case when v_ok then 'sent_' || replace(v_chat, '-', '') else 'not_ok' end;"),
    ("the error text is kept", "return case when sqlerrm ~* 'time[ds]? ?out|timeout' then 'timeout' else 'net_error' end;", "return left(lower(sqlerrm), 24);"),
    ("secrets not trimmed", "v_token := btrim(coalesce(v_token, ''));", "v_token := coalesce(v_token, '');"),
    ("no token shape check", "if v_token !~ '^[0-9]{3,20}:[A-Za-z0-9_-]{10,100}$' or v_chat", "if v_chat"),
    ("the night window ends at 06:00", "::int between 1 and 4 then", "::int between 1 and 5 then"),
    ("quiet after 20 min instead of 30", "c_quiet   constant interval := interval '30 minutes';", "c_quiet   constant interval := interval '20 minutes';"),
    ("parcels count from 0 min instead of 30", "c_young   constant interval := interval '30 minutes';", "c_young   constant interval := interval '0 minutes';"),
    ("repeat every 30 min instead of 60", "c_repeat  constant interval := interval '60 minutes';", "c_repeat  constant interval := interval '30 minutes';"),
    ("the copy on save counts as an answer", "where f.source in ('live','cache','warmup')", "where f.source in ('live','cache','warmup','instant')"),
    ("exported parcels wait too", "     where ps.status <> 'exported'\n       and (ps.store_full_status is null or ps.phone_check_status is null)",
     "     where true\n       and (ps.store_full_status is null or ps.phone_check_status is null)"),
    ("sellers with the check switched off wait too", "join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled\n     where ps.status",
     "join parcel_check_access acc on acc.user_id = ps.user_id\n     where ps.status"),
    ("the shop-pool condition is gone", "       and (v_pool_n > 0 or exists (select 1 from seller_myship_config cfg\n                                      where cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''));",
     "       ;"),
    ("'back' after an alert that never reached Telegram", "      if not st.delivered then\n        return 'closed';                     -- the alert never reached Telegram: no \"back\" either\n      end if;\n", ""),
    ("no ' (sent again)'", "c_again   constant text     := ' (sent again)';", "c_again   constant text     := '';"),
    ("4 tries", "c_tries   constant integer  := 3;", "c_tries   constant integer  := 4;"),
    ("a 401 is tried again", "if v_word = 'sent' or v_try >= c_tries\n           or not (v_word in ('timeout','net_error','not_ok','http_429')",
     "if v_word = 'sent' or v_try >= c_tries\n           or not (v_word in ('timeout','net_error','not_ok','http_429','http_401')"),
    ("a stale alert retry is sent after recovery", "if (st.retry_kind in ('alert','repeat') and v_fire) or", "if (st.retry_kind in ('alert','repeat')) or"),
    ("anon may run the check", "revoke all on function public.parcel_silence_check(timestamptz)       from public, anon, authenticated, service_role;",
     "revoke all on function public.parcel_silence_check(timestamptz)       from public, authenticated, service_role;"),
    ("every signed-in user reads the log", "for select to authenticated using (public.is_admin());", "for select to authenticated using (true);"),
    ("authenticated may read the state", "grant select on public.parcel_silence_log to authenticated;", "grant select on public.parcel_silence_log to authenticated;\ngrant select on public.parcel_silence_state to authenticated;"),
    ("the SQL editor cannot test", "v_pg   boolean := (session_user = 'postgres');", "v_pg   boolean := false;"),
    ("the app test waits 20 s", "case when v_pg then 20000 else 6000 end", "case when v_pg then 20000 else 20000 end"),
    ("no one-test-a-minute limit", "    if exists (select 1 from parcel_silence_log where kind = 'test' and at > now() - interval '1 minute') then\n      return 'too_soon';\n    end if;\n", ""),
    ("the send runs as its owner", "returns text\nlanguage plpgsql\nset search_path = public, pg_temp\nas $function$\ndeclare\n  v_token",
     "returns text\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $function$\ndeclare\n  v_token"),
]

env = dict(os.environ)
lines, bad = [], 0
text = F.read_text(encoding="utf-8")
for name, old, new in BREAKS:
    if text.count(old) != 1:
        lines.append(f"SETUP ERROR ({text.count(old)} matches): {name}"); bad += 1; print(lines[-1], flush=True); continue
    F.write_text(text.replace(old, new), encoding="utf-8")
    try:
        caught_by = []
        r1 = subprocess.run(PGL, cwd=ROOT, capture_output=True, text=True, timeout=900, env=env)
        if r1.returncode != 0:
            first = next((l for l in (r1.stdout + r1.stderr).splitlines() if l.startswith("FAIL:")), "(script stopped)")
            caught_by.append(f"PGlite: {first[:140]}")
        r2 = subprocess.run(PIN, cwd=ROOT, capture_output=True, text=True, timeout=900)
        if r2.returncode != 0:
            first = next((l.strip() for l in (r2.stdout + r2.stderr).splitlines() if l.strip().startswith(("×", "✗"))), "(failed)")
            caught_by.append(f"pins: {first[:140]}")
        if not caught_by: bad += 1
        lines.append(f"{'CAUGHT' if caught_by else 'NOT CAUGHT'}: {name}" + "".join(f"\n    {x}" for x in caught_by))
    finally:
        F.write_text(text, encoding="utf-8")
    print(lines[-1], flush=True)
OUT.write_text("\n".join(lines) + f"\n\n{len(BREAKS) - bad} of {len(BREAKS)} breaks caught\n", encoding="utf-8")
sys.exit(1 if bad else 0)
