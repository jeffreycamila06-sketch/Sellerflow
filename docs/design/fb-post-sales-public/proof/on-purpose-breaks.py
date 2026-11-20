# On-purpose breaks (2026-11-20, claude/fb-post-sales-public): each line below breaks ONE thing of this
# branch in a throw-away copy; at least one test must then fail. SQL breaks also run the PGlite proof
# (scripts/sql188-behaviour.mjs) when PGLITE_DIR is set.
#   PGLITE_DIR=/tmp/pg188 python3 -I docs/design/fb-post-sales-public/proof/on-purpose-breaks.py <copy of the branch>
# The copy needs node_modules (a link is enough).
import os, subprocess, sys, re, pathlib

root = pathlib.Path(sys.argv[1])
T = "src/redesign/adapters/__tests__/"
TESTS = [T + f for f in ["fbPostSalesNoLoss.server.test.ts", "fbPostSales.server.test.ts", "fbPostSalesPublic.test.tsx",
                         "fbPostSalesPublic.adapter.test.ts", "fbPostSalesPublicSql.test.ts", "fbPostSales.test.tsx", "fbWaitlist.test.tsx"]]
POLL = "server/fbPostSales.js"; SRV = "server.js"
AD = "src/redesign/adapters/fbPostSales.ts"; WL = "src/redesign/adapters/fbWaitlist.ts"
ORD = "src/redesign/screens/Orders.tsx"; PS = "src/redesign/screens/PostSales.tsx"; APP = "src/redesign/RedesignApp.tsx"
SQL = "sql/188_fb_post_sales_public.sql"; GUIDE = "docs/support/sfl-guide.md"; GSQL = "sql/189_guide_post_sales.sql"

BREAKS = [
    # ── 1. never lose a comment (server poller) ──
    ("a failed claim does not stop the pass", POLL, "          return stopAt(sale, args.commentId, verdict, ordered, waitlisted);", "          stopAt(sale, args.commentId, verdict, ordered, waitlisted);"),
    ("a failed waitlist write does not stop the pass", POLL, '            return stopAt(sale, args.commentId, "waitlist_failed", ordered, waitlisted);', '            stopAt(sale, args.commentId, "waitlist_failed", ordered, waitlisted);'),
    ("'not_allowed' treated as done", POLL, '} else if (verdict !== "dup") {', '} else if (verdict !== "dup" && verdict !== "not_allowed") {'),
    ("'ended' treated as done", POLL, '} else if (verdict !== "dup") {', '} else if (verdict !== "dup" && verdict !== "ended") {'),
    ("the cursor saved before the page is done", POLL, "      for (const c of r.data) {\n        if (!c || !c.id || isPageComment(c, sale.page_id)) continue;", "      if (r.after && r.after !== after) await store.saveCursor(sale.id, r.after);\n      for (const c of r.data) {\n        if (!c || !c.id || isPageComment(c, sale.page_id)) continue;"),
    ("the waitlist row without the sale", POLL, 'source: "post", sale_id: sale.id });', 'source: "post" });'),
    # ── 2. the plan rule (server) ──
    ("poller ignores the plan", POLL, "allowed === null || allowed.has(String(s.user_id))", "true"),
    ("plan unreadable → everybody", POLL, "catch (e) { allowed = new Set(); log(", "catch (e) { allowed = null; log("),
    ("picker ignores the plan", POLL, '    if (allowed !== null && !allowed.has(String(userId))) return { ok: false, error: "plan_not_allowed" };\n', ""),
    ("picker: unreadable plan allowed", POLL, 'catch { return { ok: false, error: "plan_check_failed" }; }', "catch { allowed = null; }"),
    ("a paused seller's expired sale is not ended", POLL, 'if (win === "expired") { await store.markEnded(sale.id);', 'if (win === "expired" && allowed) { await store.markEnded(sale.id);'),
    ("route: plan answer as 502", SRV, 'r.error === "plan_not_allowed" ? 403', 'r.error === "plan_not_allowed" ? 502'),
    ("server: no plan list call", SRV, 'serviceSb.rpc("fb_post_sellers_allowed", { p_uids: userIds })', 'serviceSb.rpc("fb_post_sellers", { p_uids: userIds })'),
    ("server: no retry without sale_id", SRV, '"sale_id" in row && (error.code === "PGRST204" || error.code === "42703")', 'false'),
    # ── app: who sees Posts ──
    ("Basic gets the Posts side", AD, "(POST_SALES_TIERS as readonly string[]).includes(tier)\n", "true\n"),
    ("testers lose it", AD, 'if (a.isAdmin || a.hasKey) return "full";', 'if (a.isAdmin) return "full";'),
    ("expiry ignored", AD, "daysLeft: planDaysLeft(a.planExpiry, a.nowMs ?? Date.now())", "daysLeft: Infinity"),
    ("locked tap opens Posts", ORD, "onClick={() => (locked ? onPostsLocked?.() :", "onClick={() => (locked ? openPosts() :"),
    ("no lock on the tab", ORD, '{locked && <span data-testid="ord-posts-lock"', '{false && <span data-testid="ord-posts-lock"'),
    ("app never passes the lock", APP, 'postAccess === "locked" ? { postsLocked: true,', 'postAccess === "none" ? { postsLocked: true,'),
    ("Give's plan answer shows the generic text", APP, 'v === "not_allowed" ? tApp.rd_lock_body', 'v === "x" ? tApp.rd_lock_body'),
    # ── app: end date ──
    ("picker goes past 14 days", AD, "Math.min(POST_SALE_MAX_DAYS, n)", "Math.min(30, n)"),
    ("+ never turns off", PS, "disabled={days >= POST_SALE_MAX_DAYS}", "disabled={false}"),
    ("starts at 8 days", AD, "export const POST_SALE_DEFAULT_DAYS = 7;", "export const POST_SALE_DEFAULT_DAYS = 8;"),
    ("ends_too_late not read", AD, '      if (/ends_too_late/.test(msg)) return { ok: false, error: "ends_too_late" };\n', ""),
    ("ends_too_late shows the generic text", PS, 'r.error === "ends_too_late" ? t.rd_fps_err_ends_late', 'r.error === "x" ? t.rd_fps_err_ends_late'),
    # ── app: Give and the waitlist per post ──
    ("waitlist groups ignore the post", WL, "&& x.saleId === sid)", ")"),
    ("Give stock ignores the post", AD, "    if (saleId != null && s.id !== saleId) continue;\n", ""),
    ("sale_id not read", WL, "r.source === \"post\" && r.sale_id != null && Number.isFinite(Number(r.sale_id)) ? Number(r.sale_id) : null", "null"),
    ("count read names the columns (fails before sql/188)", AD, '.select("*").eq("user_id", u).eq("status", "waiting").eq("source", "post")', '.select("code, comment_id").eq("user_id", u).eq("status", "waiting").eq("source", "post")'),
    ("count ignores the post", AD, "const own = r.sale_id == null ? null : sales.find((s) => s.id === Number(r.sale_id));", "const own = null;"),
    ("Give's 'not_allowed' dropped", AD, ' || v === "dup" || v === "not_allowed" ? v : null;', ' || v === "dup" ? v : null;'),
    # ── SQL (CI text pins + PGlite) ──
    ("Basic allowed in the database", SQL, "in ('plus', 'pro', 'master')\n", "in ('plus', 'pro', 'master', 'basic')\n"),
    ("expired status allowed", SQL, "                  and p.plan_status = 'active'\n", "                  and p.plan_status in ('active', 'expired')\n"),
    ("expiry date ignored", SQL, "                  and (p.plan_expiry is null or p.plan_expiry > now())))", "                  and true))"),
    ("30 days allowed", SQL, "if v_ends > now() + interval '14 days' + interval '10 minutes' then", "if v_ends > now() + interval '30 days' then"),
    ("a past end date allowed", SQL, "  if v_ends <= now() then raise exception 'ends_in_past'; end if;\n", ""),
    ("no 7-day default", SQL, "v_ends := coalesce(p_ends_at, now() + interval '7 days');", "v_ends := coalesce(p_ends_at, now() + interval '14 days');"),
    ("\"+1\" sales block each other again", SQL, "  if p_mode = 'code' then\n    for v_item", "  if true then\n    for v_item"),
    ("claim without the plan rule", SQL, "  if not public.fb_post_seller_allowed(v_sale.user_id) then return 'not_allowed'; end if;\n", ""),
    ("Give ignores the waiting comment's post", SQL, "  if w.sale_id is not null then\n", "  if false then\n"),
    ("Give takes another seller's sale", SQL, "where s.id = w.sale_id and s.user_id = v_uid and s.status", "where s.id = w.sale_id and s.status"),
    ("long open sales not cut", SQL, "update public.fb_post_sales s set ends_at = s.starts_at + interval '14 days'\n where s.status = 'selling'", "update public.fb_post_sales s set ends_at = s.ends_at\n where s.status = 'selling'"),
    ("a browser can call the rule", SQL, "revoke all on function public.fb_post_seller_allowed(uuid) from public, anon, authenticated;", "revoke all on function public.fb_post_seller_allowed(uuid) from public, anon;"),
    # ── help guide ──
    ("guide: the +2 line gone", GUIDE, " To buy two, comment **+2** once.", ""),
    ("guide: no plans line", GUIDE, "Posts is on the **Plus**, **Pro** and **Master** plans.", "Posts is for everyone."),
    ("guide SQL out of step with the guide", GSQL, "up to **+10**.", "up to **+9**."),
]

def run(tests):
    p = subprocess.run(["npx", "vitest", "run", *tests], cwd=root, capture_output=True, text=True, timeout=900)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(\d+) failed", out)
    suites = re.search(r"Test Files\s+(\d+) failed", out)
    return p.returncode, (int(m.group(1)) if m else 0), (int(suites.group(1)) if suites else 0)

def pglite():
    if not os.environ.get("PGLITE_DIR"): return None
    p = subprocess.run(["node", "scripts/sql188-behaviour.mjs"], cwd=root, capture_output=True, text=True, timeout=900)
    m = re.search(r"(\d+) PASS, (\d+) FAIL", p.stdout)
    return int(m.group(2)) if m else -1

base_rc, _, _ = run(TESTS)
base_pg = pglite()
print(f"without any break: tests {'all pass' if base_rc == 0 else 'FAILING — stop'}" + ("" if base_pg is None else f", PGlite {'0 FAIL' if base_pg == 0 else 'FAILING — stop'}"))
if base_rc != 0 or (base_pg not in (None, 0)): sys.exit(1)
caught = 0
for name, rel, old, new in BREAKS:
    f = root / rel
    text = f.read_text()
    n = text.count(old)
    if n != 1:
        print(f"SETUP ERROR ({n} matches): {name}")
        continue
    f.write_text(text.replace(old, new))
    try:
        rc, failed, suites = run(TESTS)
        pg = pglite() if rel == SQL else None
    finally:
        f.write_text(text)
    ok = rc != 0 or (pg is not None and pg != 0)
    caught += ok
    extra = "" if pg is None else f"; PGlite {pg} FAIL"
    print(f"{'caught' if ok else 'MISSED'}: {name} — {failed} test(s) failed" + (f", {suites} file(s) did not load" if suites and not failed else "") + extra)
print(f"{caught} of {len(BREAKS)} breaks caught")
