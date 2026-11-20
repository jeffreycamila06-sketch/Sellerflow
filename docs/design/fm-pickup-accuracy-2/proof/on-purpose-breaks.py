# On-purpose breaks (2026-11-19, claude/fm-pickup-accuracy-2): each line below breaks ONE thing of
# this branch in a throw-away copy; at least one test must then fail.
#   python3 -I docs/design/fm-pickup-accuracy-2/proof/on-purpose-breaks.py <copy of the branch>
# The copy needs node_modules (a link is enough).
import subprocess, sys, re, pathlib

root = pathlib.Path(sys.argv[1])
TESTS = [
    "src/redesign/adapters/__tests__/fmSiteAnswer.server.test.ts",
    "src/redesign/adapters/__tests__/parcelTrackingFmSite.test.ts",
    "src/redesign/screens/__tests__/ParcelTracking.fmSite.test.tsx",
    "src/redesign/adapters/__tests__/fmSiteAnswerSql.test.ts",
    "src/redesign/adapters/__tests__/keepTogether.test.ts",
]
I18N = ["src/redesign/i18n"]
SRV = "server/fmTracking.js"; RUN = "server/fmTrackingRunner.js"; WRK = "server/parcelTrackingWorker.js"
APP = "src/redesign/adapters/parcelTracking.ts"; SCR = "src/redesign/screens/ParcelTracking.tsx"
KT = "src/redesign/adapters/keepTogether.ts"
SQL = "sql/186_fm_site_answer.sql"; BACK = "sql/186_fm_site_answer_rollback.sql"; LANG = "src/redesign/i18n/index.tsx"
STAYS = " or public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status)"

BREAKS = [
    # ── server: the rule ──
    ("not_shipped saved as not_found", SRV, 'not_shipped: "not_dropped" }', 'not_shipped: "not_found" }'),
    ("10 days → 11", SRV, "export const FM_LEAVE_AFTER_DAYS = 10;", "export const FM_LEAVE_AFTER_DAYS = 11;"),
    ("leaves one day late (>)", SRV, "days >= FM_LEAVE_AFTER_DAYS", "days > FM_LEAVE_AFTER_DAYS"),
    ("not only in-transit rows", SRV, ' || row.status !== "in_transit"', ""),
    ("answered rows get the fact too", SRV, " || row.fm_answered_at) return null;", ") return null;"),
    ("date rule also for not handed in", SRV, 'if (kind === "not_found" && today', "if (today"),
    ("date rule on the date itself", SRV, "dropBy < today) return", "dropBy <= today) return"),
    ("date read on the UTC day", SRV, "const today = taipeiDayOf(nowDate);", "const today = nowDate.toISOString().slice(0, 10);"),
    ("a real answer keeps the fact", SRV, 'const said = (plain) => ({ action: "update", patch: { ...plain, fm_site_state: null }, plain });', 'const said = (plain) => ({ action: "update", patch: plain, plain });'),
    ("a parcel never leaves", SRV, "...(site.leaves ? { terminal: true } : {})", "...({})"),
    ("the old write carries the fact", SRV, "plain: base, site };", "plain: { ...base, fm_site_state: site.state }, site };"),
    ("unknown code keeps the fact", SRV, "default: // unknown, void_unclear — the row keeps its status\n      return said(base);", 'default:\n      return { action: "update", patch: base, plain: base };'),
    # ── server: the run ──
    ("answered time not read", RUN, "pickup_deadline,fm_answered_at\")", "pickup_deadline\")"),
    ("no retry without the column", RUN, "if (error && saved && fmStateColumnMissing(error)) {", "if (false) {"),
    ("keeps trying the column", RUN, "noStateColumn = true; saved = false;", "saved = false;"),
    ("left counts every nothing-yet", RUN, "if (saved && change.site && change.site.leaves) stats.left += 1;", "if (saved && change.site) stats.left += 1;"),
    ("health row without counts", RUN, "}, { fm_not_found: stats.notFound, fm_not_shipped: stats.notShipped, fm_left: stats.left || 0 }, logger);", "}, {}, logger);"),
    ("no health row without the columns", RUN, "  await writePollHealth(serviceSb, row, logger);\n}", "}"),
    ("done line without left=", RUN, " left=${stats.left || 0}", ""),
    ("PGRST204 not seen as a missing column", RUN, 'return error.code === "PGRST204" || error.code === "42703" ||', 'return error.code === "42703" ||'),
    # ── server: A ──
    ("press keeps the 24-hour skip", WRK, '  if (job.kind !== "manual") return scopeForJob(job, rows, nowDate, caps);\n  const pick', "  return scopeForJob(job, rows, nowDate, caps);\n  const pick"),
    ("no 60-per-job limit", WRK, "return { rows: pick.slice(0, caps.parcels), capped: pick.length > caps.parcels };\n}\n\n// PURE — the job row's", "return { rows: pick, capped: false };\n}\n\n// PURE — the job row's"),
    ("not the 7-11 order", WRK, "  const pick = orderForCheck(rows);\n  return { rows: pick.slice", "  const pick = rows;\n  return { rows: pick.slice"),
    ("worker still uses the old scope", WRK, ": fmScopeForJob(job, list, now(), { ...caps, parcels: FM_PARCELS_PER_JOB }));", ": scopeForJob(job, list, now(), { ...caps, parcels: FM_PARCELS_PER_JOB }));"),
    # ── app: helpers and read ──
    ("7-11 rows can be nothing-yet", APP, '  return row.carrier === "fm" && row.status === "in_transit" && !row.terminal', '  return row.status === "in_transit" && !row.terminal'),
    ("finished rows in the group", APP, 'row.status === "in_transit" && !row.terminal\n    && (row.fmSiteState', 'row.status === "in_transit"\n    && (row.fmSiteState'),
    ("leave day on the UTC day", APP, "new Date(ms + 8 * 3600000).toISOString().slice(0, 10); // Asia/Taipei", "new Date(ms).toISOString().slice(0, 10); // Asia/Taipei"),
    ("'next check' a day late", APP, "return { date, next: date <= today };", "return { date, next: date < today };"),
    ("drop-off date never shortens it", APP, "if (afterDrop < date) date = afterDrop;", "if (false) date = afterDrop;"),
    ("drop-off date shortens not-handed-in too", APP, 'if (row.fmSiteState === "not_found" && /^', "if (/^"),
    ("group sorted with the moving parcels", APP, "(isFmNothingYet(r) ? 1.5 :", "(isFmNothingYet(r) ? 1 :"),
    ("In transit number counts the group", APP, "groups.inTransit.length - groups.inTransit.filter(isFmNothingYet).length", "groups.inTransit.length"),
    ("unknown word kept", APP, 'row.fm_site_state === "not_found" || row.fm_site_state === "not_dropped" ? row.fm_site_state : null', "row.fm_site_state as never"),
    ("exact In transit count includes the group", APP, 'site ? moving().is("fm_site_state", null) : moving()', "moving()"),
    ("group count not limited to saved answers", APP, '.eq("carrier", "fm").not("fm_site_state", "is", null)', '.eq("carrier", "fm")'),
    ("no fallback when the column is missing", APP, "  fmSiteColumn = false; // sql/186 is not applied yet: read again", "  // sql/186 is not applied yet: read again"),
    ("Load more has no fallback", APP, "  if (error && fmSiteOn(fm) && fmSiteColumnMissing(error)) {", "  if (false) {"),
    # ── app: screen ──
    ("no card line", SCR, '{x === "transit" && held > 0 && <div', '{false && <div'),
    ("card line without the number", SCR, "held={heldAll} />", "held={0} />"),
    ("search shows the full group number", SCR, 'searchQ.trim() ? fullList.filter(isFmNothingYet).length : heldAll', "heldAll"),
    ("group head never placed", SCR, "(held === undefined ? -1 : rows.findIndex(isFmNothingYet))", "(-1)"),
    ("group head on every tab", SCR, 'const heldHere = tab !== "transit" ? undefined : ', "const heldHere = "),
    ("no 'No record yet' label", SCR, 'const noRecord = isFmNothingYet(row) && row.fmSiteState === "not_found";', "const noRecord = false;"),
    ("no 'next check' line", SCR, "if (leaves?.next) {", "if (false) {"),
    # ── fix round 1: right-hand lines wrap only between whole pieces ──
    ("the date can be cut", KT, "out.push({ text: date as string, keep: true, date: true });", "out.push({ text: date as string, keep: false, date: true });"),
    ("short word groups can be cut", KT, "if (graphemeCount(tok) <= SHORT_CHUNK) { out.push({ text: tok, keep: true }); continue; }", "if (graphemeCount(tok) <= SHORT_CHUNK) { out.push({ text: tok, keep: false }); continue; }"),
    ("one-character words left alone", KT, "if (words.length && graphemeCount(segment) === 1) words[words.length - 1] += segment; // join to the word before\n    else words.push(segment);", "words.push(segment);"),
    ("short chunk limit 1", KT, "export const SHORT_CHUNK = 6;", "export const SHORT_CHUNK = 1;"),
    ("lines evened out for every language", KT, "(NO_SPACE_LANGS as readonly string[]).includes(lang);", "true;"),
    ("drop-off line back to plain text", SCR, "<KeepTogether template={t.rd_pt_fm_drop_by} date={shortDate(drop.deadline, lang)} lang={lang} />", "{tpl(t.rd_pt_fm_drop_by, { date: shortDate(drop.deadline, lang) })}"),
    ("leaves-on line back to plain text", SCR, "<KeepTogether template={t.rd_pt_fm_leaves_on} date={shortDate(leaves.date, lang)} lang={lang} />", "{tpl(t.rd_pt_fm_leaves_on, { date: shortDate(leaves.date, lang) })}"),
    ("whole pieces drawn without nowrap", SCR, "<span key={i} style={{ whiteSpace: \"nowrap\" }}", "<span key={i} style={{}}"),
    # ── words ──
    ("Traditional Chinese 'No record yet' empty", LANG, '"zh-TW": "查無資料"', '"zh-TW": ""'),
    # ── SQL ──
    ("purge job at the 7-11 time", SQL, "'27 17 * * *'", "'25 17 * * *'"),
    ("upload brings a left parcel back on 'in transit'", SQL, "case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status)" + STAYS + " then t.status          else", "case when public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status) then t.status          else"),
    ("purge after 3 days", SQL, "t.last_polled_at < now() - interval '30 days'", "t.last_polled_at < now() - interval '3 days'"),
    ("upload never clears the fact", SQL, "fm_site_state   = case when excluded.status = 'in_transit' then t.fm_site_state else null end", "fm_site_state   = t.fm_site_state"),
    ("guide row keeps the old date", "sql/187_guide_fm_not_dropped.sql", "'Pickup Status', '2026-11-19'::date", "'Pickup Status', '2026-11-17'::date"),
    ("guide rollback is the new text", "sql/187_guide_fm_not_dropped_rollback.sql", "'Pickup Status', '2026-11-17'::date", "'Pickup Status', '2026-11-19'::date"),
    ("rollback leaves parcels hidden", BACK, "update public.parcel_tracking\n   set terminal = false\n where carrier = 'fm' and terminal and status = 'in_transit' and fm_site_state is not null;\n", ""),
]

def run(tests):
    p = subprocess.run(["npx", "vitest", "run", *tests], cwd=root, capture_output=True, text=True, timeout=600)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(\d+) failed", out)
    suites = re.search(r"Test Files\s+(\d+) failed", out)
    return p.returncode, (int(m.group(1)) if m else 0), (int(suites.group(1)) if suites else 0)

base_rc, _, _ = run(TESTS)
print(f"without any break: {'all pass' if base_rc == 0 else 'FAILING — stop'}")
if base_rc != 0: sys.exit(1)
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
        rc, failed, suites = run(TESTS + (I18N if rel == LANG else []))
    finally:
        f.write_text(text)
    ok = rc != 0
    caught += ok
    print(f"{'caught' if ok else 'MISSED'}: {name} — {failed} test(s) failed" + (f", {suites} file(s) did not load" if suites and not failed else ""))
print(f"{caught} of {len(BREAKS)} breaks caught")
