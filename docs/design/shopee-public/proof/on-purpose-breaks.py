# On-purpose breaks: each one must turn a test (or the database proof) red. Every file is restored after its break.
# Run from the repo root:  PGLITE_DIR=<folder with @electric-sql/pglite> python3 docs/design/shopee-public/proof/on-purpose-breaks.py
import subprocess, os, re, sys
R = os.getcwd() + '/'
GATE = 'server/shopeePublic.js'; LL = 'server/shopeeLiveLink.js'; SRV = 'server.js'
BETA = 'src/redesign/adapters/shopeeBeta.ts'; LINK = 'src/redesign/adapters/shopeeLink.ts'; APP_F = 'src/redesign/RedesignApp.tsx'
SW = 'src/redesign/adapters/featureSwitches.ts'; FA = 'src/redesign/adapters/featureAccess.ts'; ADMIN = 'src/redesign/screens/Admin.tsx'
UP = 'sql/206_shopee_public.sql'; DOWN = 'sql/206_shopee_public_rollback.sql'; GUIDE = 'docs/support/sfl-guide.md'
T = 'src/redesign/adapters/__tests__/'
TESTS = [T + 'shopeePublic.server.test.ts', T + 'shopeePublic.test.ts', T + 'shopeePublicSql.test.ts', 'src/redesign/__tests__/shopeePublic.app.test.tsx',
         T + 'parcelBatchCap.test.ts', 'src/redesign/screens/__tests__/Dashboard.shopeeLink.test.tsx']
APP = [
 # ── the server ──
 ("server: Shopee is open for everyone even when the database says no (switch off)", GATE, "    if (!r || r.error || r.data !== true) return null;\n", "    if (!r || r.error) return null;\n"),
 ("server: a database error opens Shopee", GATE, "    if (!r || r.error || r.data !== true) return null;\n", "    if (!r || r.data === false) return null;\n"),
 ("server: a thrown database call opens Shopee", GATE, "    try { r = await publicOn(req && req.authUserId); } catch { return null; }\n", "    try { r = await publicOn(req && req.authUserId); } catch { r = { data: true }; }\n"),
 ("server: the plan is not asked (an expired plan connects)", GATE, "    if (p && p.allowed === false) {", "    if (p && p.allowed === false && false) {"),
 ("server: no_profile is answered as plan_expired", GATE, 'const code = p.reason === "no_profile" ? "no_profile" : "plan_expired";', 'const code = "plan_expired";'),
 ("server: a plan check that throws refuses (TikTok allows)", GATE, "    try { p = await planCheck(req); } catch { p = null; }\n", "    try { p = await planCheck(req); } catch { p = { allowed: false, reason: \"expired\" }; }\n"),
 ("server: the refusal log line carries the seller's email", GATE, "      log(`[SHOPEE-PUBLIC] refuse code=${code}`);", "      log(`[SHOPEE-PUBLIC] refuse code=${code} ${req.userEmail}`);"),
 ("reader: a beta seller is asked the plan too (an active beta row with an expired plan is refused)", LL, "    if (!(await betaAllowed(userId, email).catch(() => false))) {\n", "    {\n"),
 ("reader: the access step is asked before the kill switch", LL, '    if (!(await enabled().catch(() => false))) return { status: 503, json: { ok: false, error: "shopee_off" } };\n    if (!(await betaAllowed', '    if (access) { await access(); }\n    if (!(await enabled().catch(() => false))) return { status: 503, json: { ok: false, error: "shopee_off" } };\n    if (!(await betaAllowed'),
 ("reader: a refused plan connects anyway", LL, '      if (a.ok !== true) return { status: Number(a.status) || 403, json: { ok: false, error: String(a.code || "no_beta") } };\n', ''),
 ("reader: 'not open' connects (the switch does nothing)", LL, '      if (!a) return { status: 403, json: { ok: false, error: "no_beta" } };\n', '      if (!a) a = { ok: true };\n'),
 ("reader: a throwing access step connects", LL, "      if (access) { try { a = await access(); } catch { a = null; } }", "      if (access) { try { a = await access(); } catch { a = { ok: true }; } }"),
 ("server.js: the access step is not handed to the Shopee routes", SRV, "{ requireConnectRate, accountGate, publicGate });", "{ requireConnectRate, accountGate });"),
 ("server.js: the plan rule is not the TikTok connect's", SRV, "      planCheck: (req) => checkPlanActive(req.userEmail, req.authUserId, req.authToken),", "      planCheck: async () => ({ allowed: true }),"),
 ("server.js: another database function is asked", SRV, 'serviceSb.rpc("shopee_public_on", { p_user: String(userId || "") })', 'serviceSb.rpc("account_limits_v2_on", { p_user: String(userId || "") })'),
 ("server.js: the TikTok plan rule lets an expired paid plan through", SRV, "    if (expiredStatus || pastExpiry) {", "    if (expiredStatus && pastExpiry) {"),
 # ── the app ──
 ("app: switch off already shows the Shopee box to every seller", BETA, "  if (!o.publicOn) return { linkOn: o.access.allowed && o.marketOk, locks, daysLeft: o.access.daysLeft };", "  if (!o.publicOn) return { linkOn: o.marketOk, locks, daysLeft: o.access.daysLeft };"),
 ("app: switch on keeps the 'Shopee access ended' lock", BETA, "  delete open.Shopee;\n", ""),
 ("app: switch on drops the active beta row's TikTok / Facebook lock", BETA, "  const open: ShopeeBetaLocks = { ...locks };", "  const open: ShopeeBetaLocks = {};"),
 ("app: switch on shows '0 days left' for an ended row", BETA, "daysLeft: o.access.allowed ? o.access.daysLeft : null };", "daysLeft: o.access.daysLeft };"),
 ("app: switch on ignores the market", BETA, "  return { linkOn: o.marketOk, locks: open,", "  return { linkOn: true, locks: open,"),
 ("app: an admin does not see it", BETA, "  return o.isAdmin || o.previewKey || o.switchOn;\n}\n\nexport interface ShopeeSellerView", "  return o.previewKey || o.switchOn;\n}\n\nexport interface ShopeeSellerView"),
 ("app: the preview login does not see it", BETA, "  return o.isAdmin || o.previewKey || o.switchOn;\n}\n\nexport interface ShopeeSellerView", "  return o.isAdmin || o.switchOn;\n}\n\nexport interface ShopeeSellerView"),
 ("app: everyone sees it (no switch)", BETA, "  return o.isAdmin || o.previewKey || o.switchOn;\n}\n\nexport interface ShopeeSellerView", "  return true;\n}\n\nexport interface ShopeeSellerView"),
 ("app: the app reads another switch", SW, 'shopeePublic: "shopee_public_enabled",', 'shopeePublic: "shopee_account_enforce",'),
 ("app: the preview key is not in the app's list", FA, '  "shopee_public", //', '  "shopee_public2", //'),
 ("app: the app asks for another preview key", APP_F, 'previewKey: hasFeature("shopee_public"), switchOn: featureSw.shopeePublic', 'previewKey: hasFeature("account_limits_v2"), switchOn: featureSw.shopeePublic'),
 ("app: plan_expired reads as 'Shopee access ended'", LINK, '  if (status === 403 && (c === "plan_expired" || c === "no_profile")) return c;\n', ''),
 ("app: an ended plan shows another text than TikTok's", LINK, 'plan_expired: "rd_cm_plan_ended",', 'plan_expired: "rd_sh_lock_ended",'),
 ("app: with Shopee open, a 403 no_beta still says 'contact Admin'", LINK, '  return publicOn && code === "no_beta" ? "rd_sh_err_unreach" : SHOPEE_LINK_ERR_KEY[code];', '  return SHOPEE_LINK_ERR_KEY[code];'),
 ("app: the iPhone app shows the plan line in the box", APP_F, '        if (code === "plan_expired" && ios) { setShopeeLinkErr(null); setIosExpired(true); }\n        else setShopeeLinkErr', '        setShopeeLinkErr'),
 ("app: the iPhone app shows nothing at all for an ended plan", APP_F, 'if (code === "plan_expired" && ios) { setShopeeLinkErr(null); setIosExpired(true); }', 'if (code === "plan_expired" && ios) { setShopeeLinkErr(null); }'),
 ("app: the Live tile uses the raw days (an ended row shows '0 days left')", APP_F, "shopeeLink={shopeeLinkOn ? { daysLeft: shopeeView.daysLeft,", "shopeeLink={shopeeLinkOn ? { daysLeft: shopeeBetaAcc.daysLeft,"),
 ("app: the free order limit skips Shopee for every seller", BETA, '  return !(betaRowActive && String(platform ?? "").trim() === "Shopee");', '  return !(String(platform ?? "").trim() === "Shopee");'),
 ("admin: the Shopee Beta row is back", ADMIN, "  // Connected Facebook Pages / Instagram accounts / Shopee shops of every seller (sql/154):", "  // adm-shopee-beta\n  // Connected Facebook Pages / Instagram accounts / Shopee shops of every seller (sql/154):"),
 # ── the SQL files and the guide ──
 ("sql/206 creates the switch already on", UP, "values ('shopee_public_enabled', 'false')", "values ('shopee_public_enabled', 'true')"),
 ("sql/206 overwrites an existing switch", UP, "values ('shopee_public_enabled', 'false')\non conflict (key) do nothing;", "values ('shopee_public_enabled', 'false')\non conflict (key) do update set value = excluded.value;"),
 ("sql/206 puts a login on the preview list", UP, "\ncommit;\n", "\ninsert into public.feature_access_emails (feature, email, is_prefix) values ('shopee_public', 'someone@example.com', false);\ncommit;\n"),
 ("sql/206: a signed-in seller may call the rule", UP, "revoke all on function public.shopee_public_on(uuid) from public, anon, authenticated;", "revoke all on function public.shopee_public_on(uuid) from public, anon;"),
 ("sql/206: the rule can raise", UP, "exception when others then\n  return false;\nend;\n$$;\nrevoke all on function public.shopee_public_on", "end;\n$$;\nrevoke all on function public.shopee_public_on"),
 ("sql/206: the rule reads another switch", UP, "public.account_switch_on('shopee_public_enabled')", "public.account_switch_on('shopee_account_enforce')"),
 ("sql/206: the preview key is missing from my_feature_access", UP, "('account_limits_v2'), ('shopee_public')\n", "('account_limits_v2')\n"),
 ("sql/206: the guard names another md5", UP, "'053c1dbd9cf744d94db14d91f767b510', 'c2839ef78c5cd5c19b75a8d6a6f7f238'", "'053c1dbd9cf744d94db14d91f767b511', 'c2839ef78c5cd5c19b75a8d6a6f7f238'"),
 ("sql/206 touches the beta table", UP, "\ncommit;\n", "\nupdate public.shopee_beta set expires_at = now();\ncommit;\n"),
 ("the rollback leaves the switch row behind", DOWN, "delete from public.app_settings where key = 'shopee_public_enabled';\n", ""),
 ("the rollback leaves the function behind", DOWN, "drop function if exists public.shopee_public_on(uuid);\n", ""),
 ("guide: still says Admin turns Shopee on", GUIDE, "Every plan can use Shopee Live, the Free plan too. You do not need to ask Admin for it.", "Admin turns Shopee Live on for you for 30 days at a time."),
 ("guide: says how it works inside", GUIDE, "If the Shopee tile shows \"Coming soon\", Shopee Live is not open for your country yet.", "If the Shopee tile shows \"Coming soon\", the switch is off for your account."),
]
# database breaks: the file still applies — the behaviour on a real Postgres must go red
DB = [
 ("database: the rule ignores the switch", "  if public.account_switch_on('shopee_public_enabled') then return true; end if;\n", ""),
 ("database: the rule opens Shopee for everyone", "  if p_user is null then return false; end if;\n", "  if p_user is not null then return true; end if;\n"),
 ("database: the rule does not know admins", "  if exists (select 1 from public.seller_profiles sp where sp.auth_user_id = p_user and lower(coalesce(sp.role, '')) = 'admin') then return true; end if;\n", ""),
 ("database: the rule reads another feature's list", "and f.feature = 'shopee_public'\n", "and f.feature = 'account_limits_v2'\n"),
 ("database: a prefix login is not matched", " or (f.is_prefix and left(lower(btrim(u.email)), length(f.email)) = f.email)));\nexception", "));\nexception"),
 ("database: the rule raises when a table is missing", "exception when others then\n  return false;\nend;\n$$;\nrevoke all on function public.shopee_public_on", "end;\n$$;\nrevoke all on function public.shopee_public_on"),
 ("database: sellers may call the rule", "revoke all on function public.shopee_public_on(uuid) from public, anon, authenticated;", "grant execute on function public.shopee_public_on(uuid) to authenticated;"),
 ("database: the switch is created on", "values ('shopee_public_enabled', 'false')", "values ('shopee_public_enabled', 'true')"),
 ("database: an 'on' switch is put back to off when the file is applied again", "values ('shopee_public_enabled', 'false')\non conflict (key) do nothing;", "values ('shopee_public_enabled', 'false')\non conflict (key) do update set value = 'false';"),
]
def run_tests():
    return subprocess.run(['npx', 'vitest', 'run', *TESTS], cwd=R, capture_output=True, text=True, timeout=900)
bad = 0; n = 0
for name, f, a, b in APP:
    n += 1
    src = open(R + f, encoding='utf8').read()
    if src.count(a) != 1: print("SETUP PROBLEM", name, src.count(a)); bad += 1; continue
    open(R + f, 'w', encoding='utf8').write(src.replace(a, b))
    try:
        if f == GUIDE: subprocess.run(['node', 'scripts/sync-guide.mjs'], cwd=R, capture_output=True, text=True)
        r = run_tests()
    finally:
        open(R + f, 'w', encoding='utf8').write(src)
        if f == GUIDE: subprocess.run(['node', 'scripts/sync-guide.mjs'], cwd=R, capture_output=True, text=True)
    m = re.search(r'Tests\s+(\d+) failed', r.stdout + r.stderr)
    caught = r.returncode != 0 and m is not None
    print(("CAUGHT  " if caught else "MISSED  ") + name + (f"  ({m.group(1)} tests red)" if m else "")); sys.stdout.flush()
    if not caught: bad += 1
if os.environ.get('PGLITE_DIR'):
    for name, a, b in DB:
        n += 1
        src = open(R + UP, encoding='utf8').read()
        if src.count(a) != 1: print("SETUP PROBLEM", name, src.count(a)); bad += 1; continue
        open(R + UP, 'w', encoding='utf8').write(src.replace(a, b))
        try: r = subprocess.run(['node', 'scripts/sql206-behaviour.mjs'], cwd=R, capture_output=True, text=True, timeout=600)
        finally: open(R + UP, 'w', encoding='utf8').write(src)
        fails = [l for l in r.stdout.split('\n') if l.startswith('FAIL')]
        crashed = r.returncode != 0 and not fails
        ok = bool(fails) or crashed
        print(("CAUGHT  " if ok else "MISSED  ") + name + (f"  ({len(fails)} checks red, e.g. \"{fails[0][5:95]}\")" if fails else "  (the proof script stopped with an error)" if crashed else "")); sys.stdout.flush()
        if not ok: bad += 1
else:
    print("(database breaks skipped: PGLITE_DIR is not set)")
print(f"\n{n - bad}/{n} caught")
sys.exit(1 if bad else 0)
