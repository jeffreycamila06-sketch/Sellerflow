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
 ("full page w/o exact = 'none'", [(A,'if (got.length >= SCAN_QR_LOOKUP_LIMIT && rows.length === 0) return { ok: false };','')]),
 ("fm reads the 7-11 table", [(A,'fm: { table: "fm_parcel_customers", col: "buyer_username" },','fm: { table: "parcel_customers", col: "notes" },')]),
 ("focus steals cursor", [(A,'if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;','')]),
 ("fills although something is typed", [(H,"      if (!blank(f)) return; // something is typed in name, phone or store → nothing is filled\n","")]),
 ("fills when ANY ONE is blank (not all three)", [(H,'f.name.trim() === "" && f.phone.trim() === "" && f.store.trim() === "";','f.name.trim() === "" || f.phone.trim() === "" || f.store.trim() === "";')]),
 ("fills the OLDEST record", [(H,"const row = res.rows[0];","const row = res.rows[res.rows.length - 1];")]),
 ("A→B: untouched details not taken back", [(H,'const wipe = untouchedFilled(prev, cur);','const wipe = {} as Partial<LookupFields>;')]),
 ("old answers not dropped", [(H,'if (!aliveRef.current || seq !== seqRef.current) return;','if (!aliveRef.current) return;')]),
 ("username-changed check off", [(H,'      if (lookupKey(f.handle) !== key) return; // the username in the field is no longer the scanned one\n','')]),
 ("reset takes no new number", [(H,'    seqRef.current++;\n    const wrote = markRef.current !== null;','    const wrote = markRef.current !== null;')]),
 ("Save press does not drop the answer", [(H,'const drop = useCallback(() => { seqRef.current++; }, []);','const drop = useCallback(() => { /* off */ }, []);')]),
 ("the fill is not remembered", [(H,'      setMark({ handle: key, filled });\n','')]),
 ("a scan keeps the old fill memory", [(H,'    fieldsRef.current = { ...cur, ...wipe, handle };\n    setMark(null);','    fieldsRef.current = { ...cur, ...wipe, handle };')]),
 ("import never clears a filled entry", [(H,'    return wrote;\n','    return false;\n')]),
 ("import always clears the entry", [(H,'    return wrote;\n','    return true;\n')]),
 ("error fills nothing but 'no rows' check dropped", [(H,'if (!res.ok || res.rows.length === 0) return;','if (!res.ok) return;')]),
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
        out=subprocess.run(['npx','vitest','run',*tests],cwd=ROOT,capture_output=True,text=True,timeout=250).stdout
    finally:
        for f in orig: open(f,'w',encoding='utf-8').write(orig[f])
    m=re.search(r'Tests\s+(?:(\d+) failed)?',out)
    failed=int(m.group(1)) if m and m.group(1) else 0
    if 'Tests ' not in out: failed=-1
    print(("RED  %3d" % failed if failed else "GREEN — NOT CAUGHT")+" : "+name, flush=True)
    if not failed: bad+=1
print("cases",lo,"-",min(hi,len(muts)),"of",len(muts),"| not caught / skipped:",bad)
