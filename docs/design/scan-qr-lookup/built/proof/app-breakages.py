import subprocess, re, sys
ROOT=sys.argv[1].rstrip('/')+'/'
A=ROOT+'src/redesign/adapters/scanQrLookup.ts'
H=ROOT+'src/redesign/adapters/useScanQrLookup.ts'
P=ROOT+'src/redesign/screens/ParcelScan.tsx'
F=ROOT+'src/redesign/screens/FmParcelScan.tsx'
D=ROOT+'src/redesign/adapters/parcelDrafts.ts'
SG='if (lookupOn && !editing) lookup.scanned('
IMP7='if (lookup.reset()) { clearForm(); setSaveErr(""); }'
IMPF='if (lookup.reset()) { clearForm(); setSaveErr(false); }'
muts=[
 ("rule 4: 'pedro123 (U)' (no @) counts", [(A,"const KEY_EXACT = new RegExp(`^[${WS}]*([A-Za-z0-9._]{1,50})[${WS}]*$`);","const KEY_EXACT = new RegExp(`^[${WS}]*([A-Za-z0-9._]{1,50})(?:[${WS}][\\\\s\\\\S]*)?$`);")]),
 ("rule 4: glued '@pedro123(U)' counts", [(A,"([A-Za-z0-9._]{1,50})(?:[${WS}][\\\\s\\\\S]*)?$`);","([A-Za-z0-9._]{1,50})[\\\\s\\\\S]*$`);")]),
 ("rule 4: note in front '(U) @pedro123' counts", [(A,"const KEY_AT = new RegExp(`^[${WS}]*@","const KEY_AT = new RegExp(`@")]),
 ("rule 4: case-sensitive", [(A,'const k = m ? m[1].toLowerCase() : "";','const k = m ? m[1] : "";')]),
 ("rule 4: 'unknown' is a username", [(A,'return k === "unknown" ? "" : k;','return k;')]),
 ("rule 4: prefix match (pedro12 ⊂ pedro123)", [(A,"usernameKeyOf(r.username) === key)","usernameKeyOf(r.username).startsWith(key))")]),
 ("any app matches", [(A,'return v === "" || v === "tiktok";','return true;')]),
 ("own-rows app check off", [(A,'.filter((r) => str(r.user_id) === me)','.filter(() => true)')]),
 ("no explicit user_id", [(A,'        .eq("user_id", me)\n','')]),
 ("OLDEST first", [(A,"a.updatedAt < b.updatedAt ? 1 : -1));","a.updatedAt < b.updatedAt ? -1 : 1));")]),
 ("tie → bigger id", [(A,"(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)","(a.id < b.id ? 1 : a.id > b.id ? -1 : 0)")]),
 ("a query shape dropped ('@key …')", [(A,"[`${key}`, `@${key}`, `@${key} %`, `@ ${key}`, `@ ${key} %`]","[`${key}`, `@${key}`, `@ ${key}`, `@ ${key} %`]")]),
 ("no time limit", [(A,'return await Promise.race([read, late]);','return await read;')]),
 ("a full page is trusted (no 'could not read')", [(A,'if (got.length >= SCAN_QR_LOOKUP_LIMIT) return { ok: false };','')]),
 ("a full page with an exact record in it still fills", [(A,'if (got.length >= SCAN_QR_LOOKUP_LIMIT) return { ok: false };','if (got.length >= SCAN_QR_LOOKUP_LIMIT && rows.length === 0) return { ok: false };')]),
 ("shared-word guard removed (3+ phones still fill)", [(A,'  if (distinctPhones(rows) >= SCAN_QR_SHARED_PHONES) return null;\n','')]),
 ("shared-word guard at 4 phones", [(A,'export const SCAN_QR_SHARED_PHONES = 3;','export const SCAN_QR_SHARED_PHONES = 4;')]),
 ("shared-word guard at 2 phones", [(A,'export const SCAN_QR_SHARED_PHONES = 3;','export const SCAN_QR_SHARED_PHONES = 2;')]),
 ("shared-word guard counts RECORDS, not different phones", [(A,'  return seen.size;','  return rows.length;')]),
 ("shared-word guard: spaces / dashes make a new phone", [(A,'    if (p !== "") seen.add(digits !== "" ? digits : p);','    if (p !== "") seen.add(p);')]),
 ("shared-word guard: a blank phone is counted", [(A,'    if (p !== "") seen.add(digits !== "" ? digits : p);','    seen.add(digits !== "" ? digits : p);')]),
 ("the hook ignores the shared-word guard", [(H,'const row = recordToFill(res.rows);','const row = res.rows[0] ?? null;')]),
 ("fm reads the 7-11 table", [(A,'fm: { table: "fm_parcel_customers", col: "buyer_username" },','fm: { table: "parcel_customers", col: "notes" },')]),
 ("focus steals cursor", [(A,'if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;','')]),
 ("fills although something is typed", [(H,"      if (!blank(f)) return; // something is typed in name, phone or store → nothing is filled\n","")]),
 ("fills when ANY ONE is blank (not all three)", [(H,'f.name.trim() === "" && f.phone.trim() === "" && f.store.trim() === "";','f.name.trim() === "" || f.phone.trim() === "" || f.store.trim() === "";')]),
 ("fills the OLDEST record", [(A,"  return rows[0] ?? null;","  return rows[rows.length - 1] ?? null;")]),
 ("A→B: untouched details not taken back", [(H,'const wipe = untouchedFilled(prev, cur);','const wipe = {} as Partial<LookupFields>;')]),
 ("old answers not dropped", [(H,'if (!aliveRef.current || seq !== seqRef.current) return;','if (!aliveRef.current) return;')]),
 ("username-changed check off", [(H,'      if (lookupKey(f.handle) !== key) return; // the username in the field is no longer the scanned one\n','')]),
 ("reset takes no new number", [(H,'    seqRef.current++;\n    const m = markRef.current;','    const m = markRef.current;')]),
 ("import clears an entry the seller fully retyped", [(H,'const wrote = m !== null && Object.keys(untouchedFilled(m, fieldsRef.current)).length > 0;','const wrote = m !== null;')]),
 ("Save press does not drop the answer", [(H,'const drop = useCallback(() => { seqRef.current++; }, []);','const drop = useCallback(() => { /* off */ }, []);')]),
 ("the fill is not remembered", [(H,'      setMark({ handle: key, filled });\n','')]),
 ("a scan keeps the old fill memory", [(H,'    fieldsRef.current = { ...cur, ...wipe, handle };\n    setMark(null);','    fieldsRef.current = { ...cur, ...wipe, handle };')]),
 ("import never clears a filled entry", [(H,'    return wrote;\n','    return false;\n')]),
 ("import always clears the entry", [(H,'    return wrote;\n','    return true;\n')]),
 ("'no record' check dropped in the hook", [(H,'      if (!row) return; // exactly as before\n','')]),
 ("gate off: hook + 7-11 screen", [(H,'if (!o.on || o.blocked) return;','if (o.blocked) return;'),(H,'if (!now.on || now.blocked) return;','if (now.blocked) return;'),(P,SG,'if (!editing) lookup.scanned(')]),
 ("gate off: hook + FM screen", [(H,'if (!o.on || o.blocked) return;','if (o.blocked) return;'),(H,'if (!now.on || now.blocked) return;','if (now.blocked) return;'),(F,SG,'if (!editing) lookup.scanned(')]),
 ("edit mode looks up: hook + 7-11", [(H,'if (!o.on || o.blocked) return;','if (!o.on) return;'),(H,'if (!now.on || now.blocked) return;','if (!now.on) return;'),(P,SG,'if (lookupOn) lookup.scanned(')]),
 ("edit mode looks up: hook + FM", [(H,'if (!o.on || o.blocked) return;','if (!o.on) return;'),(H,'if (!now.on || now.blocked) return;','if (!now.on) return;'),(F,SG,'if (lookupOn) lookup.scanned(')]),
 ("7-11 clearForm keeps the fill memory", [(P,'setForm(emptyForm); setNoHandle(false); lookup.reset(); };','setForm(emptyForm); setNoHandle(false); };')]),
 ("FM clearForm keeps the fill memory", [(F,'setForm(emptyForm); setNoHandle(false); lookup.reset(); };','setForm(emptyForm); setNoHandle(false); };')]),
 ("7-11 edit start: answer not dropped (reset + blocked off)", [(P,'    lookup.reset(); // editing a saved parcel: no lookup\n',''),(H,'if (!now.on || now.blocked) return;','if (!now.on) return;')]),
 ("FM edit start: answer not dropped (reset + blocked off)", [(F,'    lookup.reset(); // editing a saved parcel: no lookup\n',''),(H,'if (!now.on || now.blocked) return;','if (!now.on) return;')]),
 ("7-11 import keeps the filled entry", [(P,IMP7,'lookup.reset();')]),
 ("FM import keeps the filled entry", [(F,IMPF,'lookup.reset();')]),
 ("7-11 import keeps the old save error", [(P,IMP7,'if (lookup.reset()) { clearForm(); }')]),
 ("FM import keeps the old save error", [(F,IMPF,'if (lookup.reset()) { clearForm(); }')]),
 ("7-11 photo marks kept after a fill", [(P,'setConfid((c) => (c ? { ...c, name: "high", phone: "high", store_id: "high" } : c));','')]),
 ("7-11 new photo keeps the fill memory (scanOne + clearForm)", [(P,'        lookup.reset(); // a new photo is a new parcel\n',''),(P,'setForm(emptyForm); setNoHandle(false); lookup.reset(); };','setForm(emptyForm); setNoHandle(false); };')]),
 ("7-11 photo Save press does not drop", [(P,'    setSaving(true); setSaveErr("");\n    lookup.drop(); // an answer still on its way must not land during or after this save','    setSaving(true); setSaveErr("");')]),
 ("draft drops the fill memory", [(D,'...(draft.lookup ? { lookup: draft.lookup } : {}) });','});')]),
 ("hold keeps the fill memory", [(D,'{ form: blankOf(before.form), noHandle: false, platform: before.platform }','{ ...before, form: blankOf(before.form), noHandle: false }')]),
]
tests=['src/redesign/adapters/__tests__/scanQrLookup.test.ts','src/redesign/screens/__tests__/ScanQrLookup.screens.test.tsx','src/redesign/screens/__tests__/ScanQrLookup.offOn.test.tsx','src/redesign/screens/__tests__/ScanQrLookup.camera.test.tsx']
lo,hi=int(sys.argv[2]),int(sys.argv[3])
bad=0
for name,edits in muts[lo:hi]:
    orig={}; ok=True
    for f,a,b in edits:
        if f not in orig: orig[f]=open(f,encoding='utf-8').read()
    cur=dict(orig)
    for f,a,b in edits:
        if cur[f].count(a)!=1: ok=False; print("SKIP anchor",cur[f].count(a),name,'|',a[:50])
        cur[f]=cur[f].replace(a,b)
    if not ok: bad+=1; continue
    for f in cur: open(f,'w',encoding='utf-8').write(cur[f])
    try:
        proc=subprocess.run(['npx','vitest','run',*tests],cwd=ROOT,capture_output=True,text=True,timeout=600)
        out=proc.stdout
    finally:
        for f in orig: open(f,'w',encoding='utf-8').write(orig[f])
    m=re.search(r'Tests\s+(?:(\d+) failed)?',out)
    failed=int(m.group(1)) if m and m.group(1) else 0
    if 'Tests ' not in out: failed=-1
    # a run that ends with an error outside a test (an unhandled rejection) also FAILS the run (exit code 1)
    crashed = (not failed) and proc.returncode != 0
    print(("RED  %3d" % failed if failed else ("RED  run failed (unhandled error, exit %d)" % proc.returncode if crashed else "GREEN — NOT CAUGHT"))+" : "+name, flush=True)
    if not failed and not crashed: bad+=1
print("cases",lo,"-",min(hi,len(muts)),"of",len(muts),"| not caught / skipped:",bad)
