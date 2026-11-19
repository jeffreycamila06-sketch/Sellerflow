#!/usr/bin/env python3
"""On-purpose breaks for the 全家 tab fix (claude/fm-pickup-accuracy). Each break changes ONE thing in a
COPY of the source, runs the test files of the fix, and must make at least one test fail."""
import subprocess, sys, re, os, json, time
ROOT = "<a scratch copy of the branch>"
T = "src/redesign/adapters/__tests__/"
TESTS = [T + "fmPickup.test.ts", T + "parcelTrackingFmStorePickup.test.ts", T + "fmShipTypeSql.test.ts", T + "parcelTrackingTabs.test.ts", T + "parcelTrackingFm.test.ts",
         "src/redesign/screens/__tests__/ParcelTracking.fmStorePickup.test.tsx", "src/redesign/screens/__tests__/ParcelTracking.fm.test.tsx"]
FP, PT, SQ, SR = "src/redesign/adapters/fmPickup.ts", "src/redesign/adapters/parcelTracking.ts", "sql/184_fm_ship_type_fix.sql", "sql/184_fm_ship_type_fix_rollback.sql"
B = []
def b(group, label, file, old, new): B.append((group, label, file, old, new))

RULE = "  if (!t || STORE_WORDS.test(t) || !NOT_STORE_WORDS.test(t)) return FM_STORE_PICKUP;"
G = "1 the reader of the 好賣+ file"
b(G, "the old rule: only a text with 店到店 is saved as C2C (the bug)", FP, RULE + "\n  return t;", "  return t.includes(\"店到店\") ? FM_STORE_PICKUP : (t || null as never);")
b(G, "全家店寄店取 is saved as C2C, but any other unknown text keeps its words", FP, RULE, "  if (!t || STORE_WORDS.test(t)) return FM_STORE_PICKUP;")
b(G, "an empty 配送方式 is saved empty", FP, RULE, "  if (!t) return t;\n" + RULE)
b(G, "店寄店取 is not a store word (a text with both words is not a store pickup)", FP, "const STORE_WORDS = /店到店|店寄店取/;", "const STORE_WORDS = /店到店/;")
b(G, "店到店 is not a store word", FP, "const STORE_WORDS = /店到店|店寄店取/;", "const STORE_WORDS = /店寄店取/;")
b(G, "home delivery (宅配) is saved as a store pickup", FP, "const NOT_STORE_WORDS = /宅配|社區/;", "const NOT_STORE_WORDS = /社區/;")
b(G, "community pickup (社區) is saved as a store pickup", FP, "const NOT_STORE_WORDS = /宅配|社區/;", "const NOT_STORE_WORDS = /宅配/;")
b(G, "the not-store words win over the store words", FP, RULE, "  if (!t || !NOT_STORE_WORDS.test(t)) return FM_STORE_PICKUP;")
b(G, "a store pickup is saved under another word than C2C", FP, 'export const FM_STORE_PICKUP = "C2C";', 'export const FM_STORE_PICKUP = "STORE";')
b(G, "the text is not trimmed before it is kept", FP, "  return t;\n}\n\nfunction storeIdOf", "  return String(method);\n}\n\nfunction storeIdOf")
b(G, "the parser does not use the rule (stores the file's text)", FP, '      ship_type: fmShipType(get(r, "shipType")),', '      ship_type: get(r, "shipType").trim() || null,')
b(G, "frozen (a 冷凍 text) is not a store pickup", FP, "const NOT_STORE_WORDS = /宅配|社區/;", "const NOT_STORE_WORDS = /宅配|社區|冷凍/;")
b(G, "a filled 宅配取件地址 cell makes the row a home delivery", FP, '      ship_type: fmShipType(get(r, "shipType")),', '      ship_type: Object.values(r.cells).some((v) => String(v).includes("某某路")) ? "宅配" : fmShipType(get(r, "shipType")),')

IN = "  return row.carrier === \"fm\" && String(row.shipType ?? \"\").trim() === FM_STORE_PICKUP_SAVED[1] && String(row.specialType || \"\").trim() === \"\";"
G = "2 the tabs (groupParcels / rowTab)"
b(G, "the saved words 全家店寄店取 are not accepted (the bug)", PT, IN, "  return false;")
b(G, "a 7-11 row with the 全家 words is accepted too", PT, IN, IN.replace('row.carrier === "fm" && ', ""))
b(G, "every 全家 row is in a status tab (home delivery too)", PT, IN, '  return row.carrier === "fm";')
b(G, "a 全家 row with a special flow is in a status tab", PT, IN, '  return row.carrier === "fm" && String(row.shipType ?? "").trim() === FM_STORE_PICKUP_SAVED[1];')
b(G, "the saved text is not trimmed", PT, IN, IN.replace('String(row.shipType ?? "").trim()', 'String(row.shipType ?? "")'))
b(G, "a 全家 C2C row is NOT in a status tab (only the old words are)", PT, "  if (isChaseable(row.shipType, row.specialType)) return true;\n  return row.carrier", "  if (row.carrier !== \"fm\" && isChaseable(row.shipType, row.specialType)) return true;\n  return row.carrier")
b(G, "groupParcels still uses the old rule", PT, "    if (!inStatusTabs(r)) { g.other.push(r); continue; }", "    if (!isChaseable(r.shipType, r.specialType)) { g.other.push(r); continue; }")
b(G, "rowTab still uses the old rule", PT, "  if (!inStatusTabs(row)) return null;\n  if (row.status === \"at_store\") return \"waiting\";", "  if (!isChaseable(row.shipType, row.specialType)) return null;\n  if (row.status === \"at_store\") return \"waiting\";")
b(G, "the old words are typed wrongly (全家店到店)", PT, 'export const FM_STORE_PICKUP_SAVED = ["C2C", "全家店寄店取"] as const;', 'export const FM_STORE_PICKUP_SAVED = ["C2C", "全家店到店"] as const;')
b(G, "a 全家 row not checked yet goes to In transit like a 7-11 one", PT, '  if (isUnchecked(row)) return row.carrier === "fm" ? "waiting" : "transit"; // not checked yet — same as groupParcels', '  if (isUnchecked(row)) return "transit";')

CNT = '    (fm ? q.in("ship_type", [...FM_STORE_PICKUP_SAVED]) : q.eq("ship_type", "C2C")).or("special_type.is.null,special_type.eq.");'
G = "3 the exact tab counts"
b(G, "the counts still ask for ship_type = C2C only (the bug)", PT, CNT, '    q.eq("ship_type", "C2C").or("special_type.is.null,special_type.eq.");')
b(G, "with 全家 OFF the count question changes too", PT, CNT, '    q.in("ship_type", [...FM_STORE_PICKUP_SAVED]).or("special_type.is.null,special_type.eq.");')
b(G, "the counts ask for the old words only (a C2C row is not counted)", PT, CNT, '    (fm ? q.in("ship_type", [FM_STORE_PICKUP_SAVED[1]]) : q.eq("ship_type", "C2C")).or("special_type.is.null,special_type.eq.");')
b(G, "the counts count every 全家 row (home delivery too)", PT, CNT, '    (fm ? q.in("carrier", ["711", "fm"]) : q.eq("ship_type", "C2C")).or("special_type.is.null,special_type.eq.");')
b(G, "the counts drop the 'no special flow' condition when 全家 is on", PT, CNT, '    (fm ? q.in("ship_type", [...FM_STORE_PICKUP_SAVED]) : q.eq("ship_type", "C2C").or("special_type.is.null,special_type.eq."));')
b(G, "the on/off of the count rule is the wrong way round", PT, CNT, '    (!fm ? q.in("ship_type", [...FM_STORE_PICKUP_SAVED]) : q.eq("ship_type", "C2C")).or("special_type.is.null,special_type.eq.");')

G = "4 the SQL file"
b(G, "it changes rows of every carrier", SQ, "   where carrier = 'fm'\n     and ship_type = '全家店寄店取'", "   where ship_type = '全家店寄店取'")
b(G, "it changes every 全家 row, whatever its words", SQ, "   where carrier = 'fm'\n     and ship_type = '全家店寄店取'", "   where carrier = 'fm'")
b(G, "it writes another word than C2C", SQ, "     set ship_type = 'C2C'", "     set ship_type = 'STORE'")
b(G, "it also changes the status", SQ, "     set ship_type = 'C2C'", "     set ship_type = 'C2C', status = 'in_transit'")
b(G, "the helper table is readable from a browser (no row security)", SQ, "alter table public.parcel_tracking_fm_ship_type_184 enable row level security; -- no policy: no browser access\n", "")
b(G, "the helper table is not kept away from browser roles", SQ, "revoke all on table public.parcel_tracking_fm_ship_type_184 from public, anon, authenticated;\n", "")
b(G, "the changed rows are not noted (no exact rollback)", SQ, "insert into public.parcel_tracking_fm_ship_type_184 (id, old_ship_type)\nselect id, '全家店寄店取' from changed;", "select count(*) from changed;")
b(G, "no transaction", SQ, "begin;\nset local lock_timeout = '5s';", "set lock_timeout = '5s';")
b(G, "the rollback sets back every 全家 C2C row (the 6 that were C2C too)", SR, " where p.id = b.id\n   and p.carrier = 'fm'\n   and p.ship_type = 'C2C';", " where p.carrier = 'fm'\n   and p.ship_type = 'C2C';")
b(G, "the rollback leaves the helper table", SR, "drop table public.parcel_tracking_fm_ship_type_184;\n", "")
b(G, "the rollback also touches a row whose words changed since", SR, "   and p.ship_type = 'C2C';", "   ;")

only = [a.lower() for a in sys.argv[1:] if not a.startswith("--")]
results = []
t_start = time.time()
for group, label, file, old, new in B:
    if only and not any(o in label.lower() or o in group.lower() for o in only): continue
    path = os.path.join(ROOT, file)
    src = open(path, encoding="utf8").read()
    n = src.count(old)
    if n != 1:
        results.append((group, label, file, "NOT APPLIED (%d matches)" % n, 0, [])); print("??  ", group, "|", label, n, flush=True); continue
    try:
        open(path, "w", encoding="utf8").write(src.replace(old, new))
        p = subprocess.run(["npx", "vitest", "run", "--testTimeout=8000", *TESTS], cwd=ROOT, capture_output=True, text=True, timeout=900)
        out = p.stdout + p.stderr
        m = re.search(r"Tests\s+(\d+) failed", out)
        failed = int(m.group(1)) if m else 0
        names = re.findall(r"^\s+×\s+(.*?)\s+\d+ms$", out, re.M)
        status = "CAUGHT" if failed > 0 else ("CAUGHT (a test file does not load)" if p.returncode != 0 else "MISSED")
        results.append((group, label, file, status, failed, names[:3])); print(("ok  " if status == "CAUGHT" else "MISS"), group, "|", label, "→", failed, "tests fail", ("" if status == "CAUGHT" else status), flush=True)
    finally:
        open(path, "w", encoding="utf8").write(src)
json.dump(results, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "breaksFm.json"), "w"), ensure_ascii=False, indent=1)
caught = sum(1 for r in results if r[3] == "CAUGHT")
print("\nDONE breaks=%d caught=%d other=%d not_applied=%d seconds=%d" % (len(results), caught, sum(1 for r in results if r[3] != "CAUGHT" and not r[3].startswith("NOT")), sum(1 for r in results if r[3].startswith("NOT")), time.time() - t_start))
