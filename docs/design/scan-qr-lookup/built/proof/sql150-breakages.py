# Deliberately breaks a COPY of sql/150 in many ways and runs the proof on each: every breakage must turn the proof red.
#   python3 sql150-breakages.py <repo> <first> <last>      (run from the scratch folder that has PGlite + the proof script)
import subprocess, re, sys
R=sys.argv[1].rstrip('/')+'/'
src=open(R+'sql/150_one_username_one_record.sql',encoding='utf-8').read()
A7 = "                 filter (where c.phone = v_phone\n                            or (v_name is not null and lower(trim(coalesce(c.name, ''))) = lower(v_name))),  -- (A)"
AF = "               filter (where c.phone = v_phone\n                          or (v_name is not null and lower(trim(coalesce(c.name, ''))) = lower(v_name))),  -- (A)"
N7 = "               count(*) filter (where not (c.phone = v_phone\n                                           and lower(trim(coalesce(c.name, ''))) = lower(trim(coalesce(v_name, '')))))"
NF = "             count(*) filter (where not (c.phone = v_phone\n                                         and lower(trim(coalesce(c.name, ''))) = lower(trim(coalesce(v_name, '')))))"
READY = "      v_ready := coalesce(new.store_check_status = 'valid' and new.phone_check_status = 'ok', false);"
STALE = "        if new.store_id is distinct from old.store_id or new.phone is distinct from old.phone then"
SB7 = "         and (trim(coalesce(p.phone, '')) = v_phone\n              or (v_name is not null and lower(trim(coalesce(p.customer_name, ''))) = lower(v_name)));"
SBF = "         and (trim(coalesce(p.phone, '')) = v_phone\n              or (v_name is not null and lower(trim(coalesce(p.recipient_name, ''))) = lower(v_name)));"
OKC = "      select count(*) filter (where p.store_check_status = 'valid' and p.phone_check_status = 'ok'),"
muts=[
 ("7-11: a parcel with no name takes part", "       and v_name is not null  -- a parcel with no name: exactly as before (it must never replace a named record)\n", "", 1),
 ("gate ignored (rule on for everyone)", "       and public.scan_qr_lookup_on(new.user_id) then", "       and true then", 2),
 ("7-11 guard A off: any record of the username is merged", A7, "                 filter (where true),  -- (A)", 1),
 ("FM guard A off: any record of the username is merged", AF, "               filter (where true),  -- (A)", 1),
 ("7-11 guard A: phone only (same name does not count)", A7, "                 filter (where c.phone = v_phone),  -- (A)", 1),
 ("FM guard A: phone only", AF, "               filter (where c.phone = v_phone),  -- (A)", 1),
 ("7-11 guard A: name only (same phone does not count)", A7, A7.replace("c.phone = v_phone\n", "false\n"), 1),
 ("FM guard A: name only", AF, AF.replace("c.phone = v_phone\n", "false\n"), 1),
 ("7-11 guard A: no limit on other records", "        if v_n > 1 then", "        if false then", 1),
 ("FM guard A: no limit on other records", "\n      if v_n > 1 then", "\n      if false then", 1),
 ("7-11 guard A: two other records still merge", "        if v_n > 1 then", "        if v_n > 2 then", 1),
 ("FM guard A: two other records still merge", "\n      if v_n > 1 then", "\n      if v_n > 2 then", 1),
 ("7-11 guard A: the parcel's own record counts as 'other'", N7, "               count(*)", 1),
 ("FM guard A: the parcel's own record counts as 'other'", NF, "             count(*)", 1),
 ("guard B off: merged before any verdict", READY, "      v_ready := true;", 1),
 ("guard B: store verdict only", READY, "      v_ready := coalesce(new.store_check_status = 'valid', false);", 1),
 ("guard B: phone verdict only", READY, "      v_ready := coalesce(new.phone_check_status = 'ok', false);", 1),
 ("guard B: 'unknown' store counts as checked", READY, READY.replace("new.store_check_status = 'valid'", "new.store_check_status in ('valid','unknown','unchecked')"), 1),
 ("guard B: the statement that changes store / phone merges", STALE, "        if false then", 1),
 ("guard B: only a changed PHONE holds the merge back", STALE, "        if new.phone is distinct from old.phone then", 1),
 ("guard B: only a changed STORE holds the merge back", STALE, "        if new.store_id is distinct from old.store_id then", 1),
 ("guard B: a parcel inserted already checked never merges", "      if v_ready and tg_op = 'UPDATE' then", "      if v_ready then", 1),
 ("7-11 guard C off: an older parcel writes again", "        elsif v_newer_ok > 0 then", "        elsif false then", 1),
 ("FM guard C off", "      elsif v_newer > 0 then", "      elsif false then", 1),
 ("7-11 guard C: a newer parcel that is not decided yet is ignored", "      if v_newer_ok > 0 or (v_newer_open = 0 and v_ready) then", "      if v_newer_ok > 0 or (v_ready) then", 1),
 ("7-11 guard C: ANY newer parcel counts as checked OK", OKC, "      select count(*),", 1),
 ("7-11 guard C: a restricted newer parcel counts as 'not decided'", "                                and coalesce(p.phone_check_status, '') <> 'restricted'\n", "", 1),
 ("7-11 guard C: a refused-store newer parcel counts as 'not decided'", "                                and (p.store_check_status is null or p.store_check_status in ('valid', 'unchecked', 'unknown')))", "                                and true)", 1),
 ("7-11 guard C: skips although the buyer has no record", "          if v_ids is not null then\n            v_skip := true;", "          if true then\n            v_skip := true;", 1),
 ("FM guard C: skips although the buyer has no record", "        if v_ids is not null then\n          v_skip := true;", "        if true then\n          v_skip := true;", 1),
 ("7-11 guard C blocks older parcels of OTHER buyers too", "\n"+SB7, ";", 1),
 ("FM guard C blocks other buyers too", "\n"+SBF, ";", 1),
 ("7-11 guard C: same buyer = same NAME only", SB7, SB7.replace("(trim(coalesce(p.phone, '')) = v_phone\n", "(false\n"), 1),
 ("FM guard C: same buyer = same NAME only", SBF, SBF.replace("(trim(coalesce(p.phone, '')) = v_phone\n", "(false\n"), 1),
 ("7-11 guard C: same buyer = same PHONE only", SB7, "         and (trim(coalesce(p.phone, '')) = v_phone);", 1),
 ("FM guard C: same buyer = same PHONE only", SBF, "         and (trim(coalesce(p.phone, '')) = v_phone);", 1),
 ("guard C looks at OLDER parcels", "         and p.created_at >= new.created_at\n         and (p.created_at > new.created_at or p.id > new.id)", "         and p.created_at <= new.created_at\n         and (p.created_at < new.created_at or p.id < new.id)", 2),
 ("guard C: same save time = nobody is newer", "         and (p.created_at > new.created_at or p.id > new.id)", "         and p.created_at > new.created_at", 2),
 ("guard C: same save time = both are newer", "         and (p.created_at > new.created_at or p.id > new.id)\n", "", 2),
 ("7-11 guard C counts newer parcels of another app", "         and (p.contact_platform is null or p.contact_platform = 'tiktok')\n         and trim(coalesce(p.phone, '')) <> ''\n", "         and trim(coalesce(p.phone, '')) <> ''\n", 1),
 ("FM guard C counts newer parcels of another app", "         and (p.contact_platform is null or p.contact_platform = 'tiktok')\n         and p.buyer_username is not null\n", "         and p.buyer_username is not null\n", 1),
 ("7-11 guard C: no rule #4 on the newer parcel", "         and public.scan_qr_username_key(p.notes) = v_key\n", "", 1),
 ("FM guard C: no rule #4 on the newer parcel", "         and public.scan_qr_username_key(p.buyer_username) = v_key\n", "", 1),
 ("7-11 guard C counts a newer parcel with no phone", "         and trim(coalesce(p.phone, '')) <> ''\n", "", 1),
 ("guard C skip is not acted on", "  if v_skip then\n    return new;\n  end if;", "  if false then\n    return new;\n  end if;", 2),
 ("7-11: other apps' records counted", "           and (c.contact_platform is null or c.contact_platform = 'tiktok')\n           and c.notes is not null", "           and c.notes is not null", 1),
 ("FM: other apps' records counted", "         and (c.contact_platform is null or c.contact_platform = 'tiktok')\n         and c.buyer_username is not null", "         and c.buyer_username is not null", 1),
 ("7-11: no rule #4 on the records", "           and public.scan_qr_username_key(c.notes) = v_key;", "           and true;", 1),
 ("FM: no rule #4 on the records", "> 0\n         and public.scan_qr_username_key(c.buyer_username) = v_key;", "> 0\n         and true;", 1),
 ("parcel of another app merges too", "       and (new.contact_platform is null or new.contact_platform = 'tiktok')\n       and public.scan_qr_lookup_on", "       and public.scan_qr_lookup_on", 2),
 ("errors are not caught (re-raised)", "    v_ids := null; v_keep := null; v_done := false; v_skip := false;  -- as before, no clean-up", "    raise;", 2),
 ("clean-up errors are not caught", "      null;  -- the clean-up is skipped; the parcel and its record are already saved", "      raise;", 2),
 ("7-11: same phone + name record ignored", "             and c.phone = v_phone\n", "             and c.phone = v_phone and false\n", 1),
 ("FM: same phone + name record ignored", "\n           and c.phone = v_phone\n", "\n           and c.phone = v_phone and false\n", 1),
 ("clean-up deletes the kept record too", "         and c.id <> v_keep\n", "", 2),
 ("no clean-up at all", "  if v_ids is not null and v_keep is not null then", "  if false then", 2),
 ("7-11: 'record went away' not noticed", "            if found then\n              v_done := true;", "            if true then\n              v_done := true;", 1),
 ("FM: 'record went away' not noticed", "          if found then\n            v_done := true;", "          if true then\n            v_done := true;", 1),
 ("7-11 kept record: name not written", "               set name             = v_name,\n                   phone", "               set phone", 1),
 ("FM kept record: name not written", "             set name             = v_name,\n                 phone", "             set phone", 1),
 ("7-11 kept record: phone not written", "                   phone            = v_phone,\n", "", 1),
 ("FM kept record: phone not written", "\n                 phone            = v_phone,\n", "\n", 1),
 ("7-11 kept record: store not written", "                   store_id         = coalesce(nullif(trim(coalesce(new.store_id,'')), ''), c.store_id),\n", "", 1),
 ("FM kept record: store not written", "                 store_id         = coalesce(nullif(trim(coalesce(new.store_id, '')), ''), c.store_id),\n", "", 1),
 ("7-11 kept record: a parcel with no store blanks the store", "                   store_id         = coalesce(nullif(trim(coalesce(new.store_id,'')), ''), c.store_id),", "                   store_id         = nullif(trim(coalesce(new.store_id,'')), ''),", 1),
 ("7-11 kept record: contact text not written", "                   notes            = v_notes,\n", "", 1),
 ("FM kept record: contact text not written", "                 buyer_username   = v_user,\n", "", 1),
 ("7-11 kept record: app not written", "                   contact_platform = new.contact_platform,\n", "", 1),
 ("FM kept record: app not written", "\n                 contact_platform = new.contact_platform,\n", "\n", 1),
 ("7-11 kept record: 'last updated' not written", "                   contact_platform = new.contact_platform,\n                   updated_at       = now()", "                   contact_platform = new.contact_platform", 1),
 ("FM kept record: 'last updated' not written", "                 contact_platform = new.contact_platform,\n                 updated_at       = now()", "                 contact_platform = new.contact_platform", 1),
 ("rule #4: 'pedro123 (U)' (no @) counts", "substring(p_text from '^[ \\t\\n\\r\\f\\v]*([A-Za-z0-9._]{1,50})[ \\t\\n\\r\\f\\v]*$')", "substring(p_text from '^[ \\t\\n\\r\\f\\v]*([A-Za-z0-9._]{1,50})(?:[ \\t\\n\\r\\f\\v].*)?$')", 1),
 ("rule #4: glued text '@pedro123(U)' counts", "([A-Za-z0-9._]{1,50})(?:[ \\t\\n\\r\\f\\v].*)?$')", "([A-Za-z0-9._]{1,50}).*$')", 1),
 ("rule #4: 'unknown' is a username", "  )), 'unknown');", "  )), 'never');", 1),
 ("rule #4: case-sensitive", "  select nullif(lower(coalesce(", "  select nullif((coalesce(", 1),
 ("helpers left open to the browser", "revoke all on function public.scan_qr_lookup_on(uuid)    from public, anon, authenticated;", "", 1),
 ("list match ignores the feature name", "join public.feature_access_emails f on f.feature = 'scan_qr_lookup'", "join public.feature_access_emails f on true", 1),
 ("built-from check removed", "       and md5(pg_get_functiondef(f.fn::regprocedure)) <> f.built_from then", "       and false then", 1),
 ("restricted-phone rule dropped", "  if new.phone_check_status = 'restricted' then", "  if false then", 1),
 ("wrong-store rule dropped", "  if new.store_check_status is not null\n", "  if false and new.store_check_status is not null\n", 1),
]
lo,hi=int(sys.argv[2]),int(sys.argv[3])
bad=0
for i,(name,a,b,cnt) in enumerate(muts[lo:hi], start=lo):
    if src.count(a)!=cnt: print("SKIP anchor",src.count(a),"≠",cnt,":",name, flush=True); bad+=1; continue
    f='mut_%d.sql' % i
    open(f,'w',encoding='utf-8').write(src.replace(a,b))
    try:
        p=subprocess.run(['node','sql150-behaviour.mjs',R+'sql/149_scan_qr_lookup.sql',f,R+'sql/150_one_username_one_record_rollback.sql',R+'src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json'],capture_output=True,text=True,timeout=400)
        out=p.stdout
    except subprocess.TimeoutExpired:
        out=''
    m=re.search(r'(\d+) passed, (\d+) failed',out)
    failed=int(m.group(2)) if m else -1
    crashed = m is None
    if crashed: print("RED  (the proof stopped with an error) : "+name, flush=True)
    elif failed: print(("RED %4d : " % failed)+name, flush=True)
    else: print("GREEN — NOT CAUGHT : "+name, flush=True); bad+=1
print("cases",lo,"-",min(hi,len(muts))-1,"of",len(muts),"| not caught / skipped:",bad, flush=True)
