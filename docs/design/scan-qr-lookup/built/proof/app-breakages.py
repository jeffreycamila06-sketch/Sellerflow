import subprocess, re, sys
ROOT=sys.argv[1].rstrip('/')+'/'
A=ROOT+'src/redesign/adapters/scanQrLookup.ts'
H=ROOT+'src/redesign/adapters/useScanQrLookup.ts'
P=ROOT+'src/redesign/screens/ParcelScan.tsx'
F=ROOT+'src/redesign/screens/FmParcelScan.tsx'
D=ROOT+'src/redesign/adapters/parcelDrafts.ts'
SG='if (lookupOn && !editing) lookup.scanned('
GS='if (!o.on || o.blocked) return;\n    const key = lookupKey(handle);'   # the gate line of scanned()
GT='if (!o.on || o.blocked) return;\n    const prev = markRef.current;\n    if (!prev) return;'   # the gate line of typed()
SAME='if (usernameKeyOf(handle) === prev.handle) return;'
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
 ("shared-word guard looks at the 3 newest records only", [(A,'  if (distinctPhones(rows) >= SCAN_QR_SHARED_PHONES) return null;','  if (distinctPhones(rows.slice(0, 3)) >= SCAN_QR_SHARED_PHONES) return null;')]),
 ("shared-word guard looks at the 5 newest records only", [(A,'  if (distinctPhones(rows) >= SCAN_QR_SHARED_PHONES) return null;','  if (distinctPhones(rows.slice(0, 5)) >= SCAN_QR_SHARED_PHONES) return null;')]),
 ("shared-word guard: a phone that is not a number is not counted", [(A,'    if (p !== "") seen.add(digits !== "" ? digits : p);','    if (digits !== "") seen.add(digits);')]),
 ("the read asks for 1000 rows", [(A,'export const SCAN_QR_LOOKUP_LIMIT = 100;','export const SCAN_QR_LOOKUP_LIMIT = 1000;')]),
 ("same sticker again: the untouched details are taken back", [(H,'    if (prev && prev.handle === key && !blank(cur)) { fieldsRef.current = { ...cur, handle }; return; }\n','')]),
 ("same sticker again: nothing happens even with an emptied form", [(H,'    if (prev && prev.handle === key && !blank(cur)) {','    if (prev && prev.handle === key) {')]),
 ("another app picked while waiting is ignored (hook)", [(H,'      if (!tiktokRef.current) return; // another app was picked for this buyer meanwhile → nothing is filled\n','')]),
 ("a scan does not count as TikTok (hook)", [(H,'    tiktokRef.current = true; // a scan puts the buyer\'s app on TikTok; a later tap on another app turns this off\n','')]),
 ("7-11 screen never tells the hook the buyer's app", [(P,'blocked: editing !== null, tiktok: !contactOn || platform === "tiktok", initial','blocked: editing !== null, initial')]),
 ("FM screen never tells the hook the buyer's app", [(F,'blocked: editing !== null, tiktok: !contactOn || platform === "tiktok", initial','blocked: editing !== null, initial')]),
 ("7-11 screen: the app flag ignores what the picker says", [(P,'tiktok: !contactOn || platform === "tiktok"','tiktok: !contactOn')]),
 ("FM screen: the app flag ignores what the picker says", [(F,'tiktok: !contactOn || platform === "tiktok"','tiktok: !contactOn')]),
 ("7-11 screen: a hidden picker with another app left behind blocks the fill", [(P,'tiktok: !contactOn || platform === "tiktok"','tiktok: platform === "tiktok"')]),
 ("FM screen: a hidden picker with another app left behind blocks the fill", [(F,'tiktok: !contactOn || platform === "tiktok"','tiktok: platform === "tiktok"')]),
 ("no app told = not TikTok (hook default)", [(H,'tiktokRef.current = opts.tiktok !== false; });','tiktokRef.current = opts.tiktok === true; });')]),
 ("same sticker again decided by the username field, not by the remembered fill", [(H,'if (prev && prev.handle === key && !blank(cur)) {','if (prev && lookupKey(cur.handle) === key && !blank(cur)) {')]),
 ("same sticker again only counts when all three details are present", [(H,'if (prev && prev.handle === key && !blank(cur)) {','if (prev && prev.handle === key && cur.name.trim() !== "" && cur.phone.trim() !== "" && cur.store.trim() !== "") {')]),
 ("phones compared on their last 4 digits", [(A,'seen.add(digits !== "" ? digits : p);','seen.add(digits !== "" ? digits.slice(-4) : p);')]),
 ("spaces in the phone count as typed", [(H,'f.phone.trim() === ""','f.phone === ""')]),
 ("spaces in the store count as typed", [(H,'f.store.trim() === ""','f.store === ""')]),
 ("7-11: a fill also blanks the Amount", [(P,'setFields: (fn) => setForm((s) => ({ ...s, ...fn({ name: s.name, phone: s.phone, store: s.store }) })),','setFields: (fn) => setForm((s) => ({ ...s, amount: "", ...fn({ name: s.name, phone: s.phone, store: s.store }) })),')]),
 ("FM: a fill also blanks the Amount", [(F,'setFields: (fn) => setForm((s) => ({ ...s, ...fn({ name: s.name, phone: s.phone, store: s.store }) })),','setFields: (fn) => setForm((s) => ({ ...s, amount: "", ...fn({ name: s.name, phone: s.phone, store: s.store }) })),')]),
 ("spaces in the name count as typed", [(H,'const blank = (f: LookupFields): boolean => f.name.trim() === ""','const blank = (f: LookupFields): boolean => f.name === ""')]),
 ("a stored fill mark is used although the lookup is off", [(H,'useState<ScanQrLookupMark | null>(() => (opts.on ? opts.initial : null))','useState<ScanQrLookupMark | null>(() => opts.initial)')]),
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
 ("gate off: hook + 7-11 screen", [(H,GS,GS.replace('!o.on || o.blocked','o.blocked')),(H,'if (!now.on || now.blocked) return;','if (now.blocked) return;'),(P,SG,'if (!editing) lookup.scanned(')]),
 ("gate off: hook + FM screen", [(H,GS,GS.replace('!o.on || o.blocked','o.blocked')),(H,'if (!now.on || now.blocked) return;','if (now.blocked) return;'),(F,SG,'if (!editing) lookup.scanned(')]),
 ("edit mode looks up: hook + 7-11", [(H,GS,GS.replace('!o.on || o.blocked','!o.on')),(H,'if (!now.on || now.blocked) return;','if (!now.on) return;'),(P,SG,'if (lookupOn) lookup.scanned(')]),
 ("edit mode looks up: hook + FM", [(H,GS,GS.replace('!o.on || o.blocked','!o.on')),(H,'if (!now.on || now.blocked) return;','if (!now.on) return;'),(F,SG,'if (lookupOn) lookup.scanned(')]),
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
 ("hand change: the 7-11 screen does not tell the hook", [(P,'{ F({ notes: v }); lookup.typed(v); }','{ F({ notes: v }); }')]),
 ("hand change: the FM screen does not tell the hook", [(F,'{ F({ username: v }); lookup.typed(v); }','{ F({ username: v }); }')]),
 ("hand change: 7-11 picker field (typing, paste) does not tell the hook", [(P,'value={form.notes} onValue={handleByHand}','value={form.notes} onValue={(v) => F({ notes: v })}')]),
 ("hand change: FM picker field (typing, paste) does not tell the hook", [(F,'value={form.username} onValue={handleByHand}','value={form.username} onValue={(v) => F({ username: v })}')]),
 ("hand change: 7-11 plain field does not tell the hook", [(P,'const v = e.target.value.slice(0, 50); handleByHand(v);','const v = e.target.value.slice(0, 50); F({ notes: v });')]),
 ("hand change: FM plain field does not tell the hook", [(F,'const v = e.target.value.slice(0, 50); handleByHand(v);','const v = e.target.value.slice(0, 50); F({ username: v });')]),
 ("hand change: 7-11 plain 'no handle' tick does not tell the hook", [(P,'setNoHandle(on); if (on) handleByHand(""); }} data-testid="ps-no-handle"','setNoHandle(on); if (on) F({ notes: "" }); }} data-testid="ps-no-handle"')]),
 ("hand change: FM plain 'no handle' tick does not tell the hook", [(F,'setNoHandle(on); if (on) handleByHand(""); }} data-testid="fms-no-handle"','setNoHandle(on); if (on) F({ username: "" }); }} data-testid="fms-no-handle"')]),
 ("hand change: 7-11 picker 'no contact' callback writes the field directly", [(P,'onNoContact={(on) => { setNoHandle(on); if (on) handleByHand(""); }}','onNoContact={(on) => { setNoHandle(on); if (on) F({ notes: "" }); }}')]),
 ("hand change: FM picker 'no contact' callback writes the field directly", [(F,'onNoContact={(on) => { setNoHandle(on); if (on) handleByHand(""); }}','onNoContact={(on) => { setNoHandle(on); if (on) F({ username: "" }); }}')]),
 ("hand change: the same username typed another way erases too (no check)", [(H,'    '+SAME+' // still the filled buyer\'s username\n','')]),
 ("hand change: only the exact same text counts as the same username", [(H,SAME,'if (handle === prev.handle) return;')]),
 ("hand change: compared like a scan, not with rule #4 ('@x (U)' erases)", [(H,SAME,'if (lookupKey(handle) === prev.handle) return;')]),
 ("hand change: a shorter text that A's username starts with still counts as A", [(H,SAME,'if (prev.handle.startsWith(usernameKeyOf(handle))) return;')]),
 ("hand change: a longer text that starts with A's username still counts as A", [(H,SAME,'if (usernameKeyOf(handle).startsWith(prev.handle)) return;')]),
 ("hand change: any text that CONTAINS A's username counts as A ('x (U)', '@x(U)')", [(H,SAME,'if (handle.toLowerCase().includes(prev.handle)) return;')]),
 ("hand change: never erases (typed() does nothing)", [(H,'    takeBack(o, prev, fieldsRef.current, handle);\n  }, [takeBack]);','  }, [takeBack]);')]),
 ("hand change: the details go but the fill is NOT forgotten", [(H,'    takeBack(o, prev, fieldsRef.current, handle);\n  }, [takeBack]);','    takeBack(o, prev, fieldsRef.current, handle); setMark(prev);\n  }, [takeBack]);')]),
 ("hand change: the fill is forgotten but the details stay", [(H,'    takeBack(o, prev, fieldsRef.current, handle);\n  }, [takeBack]);','    setMark(null);\n  }, [takeBack]);')]),
 ("hand change: runs while a saved parcel is edited", [(H,GT,GT.replace('!o.on || o.blocked','!o.on'))]),
 ("hand change: runs with the lookup turned off", [(H,GT,GT.replace('!o.on || o.blocked','o.blocked'))]),
 ("take back: a detail the seller changed is erased too (scan of B and hand change)", [(H,'for (const k of ["name", "phone", "store"] as const) if (f[k] !== "" && s[k] === f[k]) out[k] = "";','for (const k of ["name", "phone", "store"] as const) if (f[k] !== "") out[k] = "";')]),
 ("take back: everything in the form is erased, filled or not (scan of B and hand change)", [(H,'    const wipe = untouchedFilled(prev, cur);\n    if (prev && Object.keys(wipe).length > 0) {\n      const f = prev.filled;\n      o.setFields((s) => {','    const wipe = untouchedFilled(prev, cur);\n    if (prev) {\n      const f = prev.filled;\n      o.setFields(() => ({ name: "", phone: "", store: "" })); if (false) o.setFields((s) => {')]),
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
