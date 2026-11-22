# On-purpose breaks: each one must turn a test (or the database proof) red. Every file is restored after its break.
# Run from the repo root:  PGLITE_DIR=<folder with @electric-sql/pglite> python3 docs/design/account-swap-rule/proof/on-purpose-breaks.py
import subprocess, hashlib, os, re, sys
R = os.getcwd() + '/'
PF = 'src/redesign/adapters/planFull.ts'; POP = 'src/redesign/components/PlanFullPopup.tsx'; SS = 'src/redesign/screens/ShopeeShops.tsx'
I18N = 'src/redesign/i18n/index.tsx'; UP = 'sql/205_account_swap_rule.sql'; DOWN = 'sql/205_account_swap_rule_rollback.sql'
TESTS = ['src/redesign/adapters/__tests__/planFull.test.ts', 'src/redesign/components/__tests__/PlanFullPopup.test.tsx', 'src/redesign/screens/__tests__/ShopeeShops.test.tsx',
         'src/redesign/__tests__/planFull.app.test.tsx', 'src/redesign/adapters/__tests__/accountSwapRuleSql.test.ts']
LOCK_LINE = "              and st.removed_at is null and st.lock_until > now() limit 1) end,"
APP = [
 ("popup: Remove on a locked account goes to the confirm (no 4-hour check)", POP, 'if (lockMs(a, list, now()) !== null) { setLockedPick(a); setPhase("wait"); return; } ', ''),
 ("popup: the locked sheet shows the held-place time instead of the account's own", POP, 'const ms = lockedPick ? lockMs(lockedPick, list, now()) : waitMs(list, waitFor, now());', 'const ms = waitMs(list, waitFor, now());'),
 ("popup: the locked sheet uses the removed-account words", POP, 'lockedPick ? lead(tpl(t.rd_pf_wait_locked, { name: accountName(lockedPick, t) }), "pf-lead-locked") : lead(waitLead(waitFor, t))', 'lead(waitLead(waitFor, t))'),
 ("Shopee shops: Remove on a locked shop goes to the confirm", SS, 'if (lockMs(s, list, now()) !== null) { setLocked(s); return; } ', ''),
 ("Shopee shops: the locked countdown never ticks", SS, 'const counting = wait !== null || locked !== null;', 'const counting = wait !== null;'),
 ("an admin (no limit) is locked too", PF, 'if (!a.lockUntil || !list || list.unlimited) return null;', 'if (!a.lockUntil || !list) return null;'),
 ("the lock is counted on the phone's clock, not the server's", PF, 'const serverNowMs = list.serverNow ? Date.parse(list.serverNow) + (deviceNow - list.loadedAt) : deviceNow;\n  const ms = Date.parse(a.lockUntil) - serverNowMs;', 'const ms = Date.parse(a.lockUntil) - deviceNow;'),
 ("a lock that is over still blocks Remove", PF, 'const ms = Date.parse(a.lockUntil) - serverNowMs;\n  return ms > 0 ? ms : null;', 'const ms = Date.parse(a.lockUntil) - serverNowMs;\n  return ms;'),
 ("the app drops the database's lock_until", PF, 'lockUntil: iso(a.lock_until) });', 'lockUntil: null });'),
 ("the confirm still promises a 4-hour wait (the old words)", I18N, "You can add a new account right away. After that, it can't be changed again for 4 hours.\"", 'You can add a new account after 4 hours."'),
 ("the note under the list is the old one", I18N, "en: \"You can replace an account right away. The new account then can't be changed again for 4 hours.\"", 'en: "After you remove an account, you can add a new one in 4 hours."'),
 ("the new text is missing in Thai", I18N, 'th: "{name} เพิ่งมาแทนบัญชีอื่นไม่ถึง 4 ชั่วโมง คุณจะเปลี่ยนอีกครั้งได้ในอีก:"', 'th: ""'),
 ("sql/205 keeps rule (b)'s line in account_seat_vacate", UP, "  values (p_user, p_platform, p_key, now(), now(), null, null)\n", "  values (p_user, p_platform, p_key, now(), now(), now() + public.account_lock_length(), null)\n"),
 ("sql/205: lock_until also for an account that was removed", UP, LOCK_LINE, LOCK_LINE.replace("st.removed_at is null and ", "")),
 ("sql/205: the guard names another md5", UP, "('account_seat_vacate', 'b0f298426d92f479ee8a0c4d2c252ae0'", "('account_seat_vacate', 'b0f298426d92f479ee8a0c4d2c252ae1'"),
 ("sql/205 also writes the switch", UP, "\ncommit;\n", "\nupdate public.app_settings set value = 'true' where key = 'shopee_account_enforce';\ncommit;\n"),
 ("the rollback puts back sql/84's text instead of sql/199's", DOWN, "          case when public.account_limits_v2_on(p_user) and not public.is_admin() then now() + public.account_lock_length() end, null)", "          null, null)"),
]
# database breaks: the file still applies (its guard names the broken text's md5) — the behaviour must go red
def body(s, fn):
    i = s.index(f"create or replace function public.{fn}("); a = s.index("as $$", i) + 5; return s[a:s.index("$$;", a)]
def db_break(name, fn, a, b):
    src = open(R + UP, encoding='utf8').read()
    if src.count(a) != 1: return name, None
    new = src.replace(a, b)
    new = new.replace(hashlib.md5(body(src, fn).encode()).hexdigest(), hashlib.md5(body(new, fn).encode()).hexdigest())
    open(R + UP, 'w', encoding='utf8').write(new)
    try: r = subprocess.run(['node', 'scripts/sql205-behaviour.mjs'], cwd=R, capture_output=True, text=True, timeout=600)
    finally: open(R + UP, 'w', encoding='utf8').write(src)
    return name, [l for l in r.stdout.split('\n') if l.startswith('FAIL')]
DB = [
 ("database: every removal starts a 4-hour wait (rule b)", 'account_seat_vacate', "  values (p_user, p_platform, p_key, now(), now(), null, null)\n  on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null;",
  "  values (p_user, p_platform, p_key, now(), now(), now() + public.account_lock_length(), null)\n  on conflict (user_id, platform, account_key) do update set removed_at = now(), replaced_at = null, lock_until = now() + public.account_lock_length();"),
 ("database: a removal clears the removed account's own lock (a second swap is never refused)", 'account_seat_vacate', "do update set removed_at = now(), replaced_at = null;", "do update set removed_at = now(), replaced_at = null, lock_until = null;"),
 ("database: my_account_list gives an admin a lock_until", 'my_account_list', "'lock_until', case when v_unl then null else (", "'lock_until', case when false then null else ("),
 ("database: my_account_list never gives a lock_until", 'my_account_list', "and st.removed_at is null and st.lock_until > now() limit 1) end,", "and st.removed_at is null and st.lock_until > now() and false limit 1) end,"),
]
bad = 0; n = 0
for name, f, a, b in APP:
    n += 1
    src = open(R + f, encoding='utf8').read()
    if src.count(a) != 1: print("SETUP PROBLEM", name, src.count(a)); bad += 1; continue
    open(R + f, 'w', encoding='utf8').write(src.replace(a, b))
    try: r = subprocess.run(['npx', 'vitest', 'run', *TESTS], cwd=R, capture_output=True, text=True, timeout=900)
    finally: open(R + f, 'w', encoding='utf8').write(src)
    m = re.search(r'Tests\s+(\d+) failed', r.stdout + r.stderr)
    caught = r.returncode != 0 and m is not None
    print(("CAUGHT  " if caught else "MISSED  ") + name + (f"  ({m.group(1)} tests red)" if m else "")); sys.stdout.flush()
    if not caught: bad += 1
if os.environ.get('PGLITE_DIR'):
    for name, fn, a, b in DB:
        n += 1
        name, fails = db_break(name, fn, a, b)
        if fails is None: print("SETUP PROBLEM", name); bad += 1; continue
        print(("CAUGHT  " if fails else "MISSED  ") + name + (f"  ({len(fails)} checks red, e.g. \"{fails[0][5:95]}\")" if fails else "")); sys.stdout.flush()
        if not fails: bad += 1
else:
    print("(database breaks skipped: PGLITE_DIR is not set)")
print(f"\n{n - bad}/{n} caught")
sys.exit(1 if bad else 0)
