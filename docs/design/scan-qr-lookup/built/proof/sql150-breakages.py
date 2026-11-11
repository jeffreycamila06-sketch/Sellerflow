import subprocess, re, sys
R=sys.argv[3].rstrip('/')+'/'  # the repo. Run from a scratch folder that has PGlite and a copy of scripts/sql150-behaviour.mjs: python3 sql150-breakages.py 0 99 <repo>
src=open(R+'sql/150_one_username_one_record.sql',encoding='utf-8').read()
A7="           and (c.phone = v_phone\n                or (v_name is not null and lower(trim(coalesce(c.name, ''))) = lower(v_name)));  -- (A)"
muts=[
 ("gate ignored (rule on for everyone)", "       and public.scan_qr_lookup_on(new.user_id) then", "       and true then", 2),
 ("guard A off: every record of the username is merged", A7, "           and true;", 2),
 ("guard A: phone only (same name does not count)", A7, "           and c.phone = v_phone;", 2),
 ("guard A: name only (same phone does not count)", "           and (c.phone = v_phone\n                or (v_name is not null", "           and (false\n                or (v_name is not null", 2),
 ("guard B off: merged before any verdict", "      elsif new.store_check_status = 'valid' and new.phone_check_status = 'ok' then  -- (B)", "      elsif true then  -- (B)", 1),
 ("guard B: store verdict only", "      elsif new.store_check_status = 'valid' and new.phone_check_status = 'ok' then  -- (B)", "      elsif new.store_check_status = 'valid' then  -- (B)", 1),
 ("guard B: phone verdict only", "      elsif new.store_check_status = 'valid' and new.phone_check_status = 'ok' then  -- (B)", "      elsif new.phone_check_status = 'ok' then  -- (B)", 1),
 ("guard B: 'unknown' store counts as checked", "      elsif new.store_check_status = 'valid' and", "      elsif new.store_check_status in ('valid','unknown','unchecked') and", 1),
 ("guard C off: an older parcel writes again", "      if exists (\n        select 1\n          from public.parcel_scans p", "      if false and exists (\n        select 1\n          from public.parcel_scans p", 1),
 ("FM guard C off", "      if exists (\n        select 1\n          from public.fm_parcel_scans p", "      if false and exists (\n        select 1\n          from public.fm_parcel_scans p", 1),
 ("guard C blocks older parcels of OTHER buyers too", "           and (trim(coalesce(p.phone, '')) = v_phone\n                or (v_name is not null and lower(trim(coalesce(p.customer_name, ''))) = lower(v_name)))\n", "", 1),
 ("FM guard C blocks other buyers too", "           and (trim(coalesce(p.phone, '')) = v_phone\n                or (v_name is not null and lower(trim(coalesce(p.recipient_name, ''))) = lower(v_name)))\n", "", 1),
 ("guard C looks at OLDER parcels", "           and p.created_at >= new.created_at\n           and (p.created_at > new.created_at or p.id > new.id)", "           and p.created_at <= new.created_at\n           and (p.created_at < new.created_at or p.id < new.id)", 2),
 ("guard C skip is not acted on", "  if v_skip then\n    return new;\n  end if;", "  if false then\n    return new;\n  end if;", 2),
 ("other apps' records counted", "           and (c.contact_platform is null or c.contact_platform = 'tiktok')\n           and c.notes is not null", "           and c.notes is not null", 1),
 ("FM: other apps' records counted", "           and (c.contact_platform is null or c.contact_platform = 'tiktok')\n           and c.buyer_username is not null", "           and c.buyer_username is not null", 1),
 ("parcel of another app merges too", "       and (new.contact_platform is null or new.contact_platform = 'tiktok')\n       and public.scan_qr_lookup_on", "       and public.scan_qr_lookup_on", 2),
 ("OLDEST stays instead of newest", "array_agg(c.id order by c.updated_at desc, c.id)", "array_agg(c.id order by c.updated_at asc, c.id)", 2),
 ("tie → bigger id", "array_agg(c.id order by c.updated_at desc, c.id)", "array_agg(c.id order by c.updated_at desc, c.id desc)", 2),
 ("errors are not caught (re-raised)", "    v_ids := null; v_keep := null; v_done := false; v_skip := false;  -- as before, no clean-up", "    raise;", 2),
 ("clean-up errors are not caught", "      null;  -- the clean-up is skipped; the parcel and its record are already saved", "      raise;", 2),
 ("same phone + name record ignored (always update newest)", "             and c.phone = v_phone\n", "             and c.phone = v_phone and false\n", 2),
 ("clean-up deletes the kept record too", "         and c.id <> v_keep\n", "", 2),
 ("no clean-up at all", "  if v_ids is not null and v_keep is not null then", "  if false then", 2),
 ("'record went away' not noticed", "            if found then\n              v_done := true;", "            if true then\n              v_done := true;", 2),
 ("contact text not updated", "                   notes            = v_notes,\n", "", 1),
 ("FM contact text not updated", "                   buyer_username   = v_user,\n", "", 1),
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
lo,hi=int(sys.argv[1]),int(sys.argv[2])
bad=0
for name,a,b,cnt in muts[lo:hi]:
    if src.count(a)!=cnt: print("SKIP anchor",src.count(a),"≠",cnt,":",name); bad+=1; continue
    open('mut.sql','w',encoding='utf-8').write(src.replace(a,b))
    p=subprocess.run(['node','sql150-behaviour.mjs',R+'sql/149_scan_qr_lookup.sql','mut.sql',R+'sql/150_one_username_one_record_rollback.sql',R+'src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json'],capture_output=True,text=True,timeout=300)
    m=re.search(r'(\d+) passed, (\d+) failed',p.stdout)
    failed=int(m.group(2)) if m else -1
    crashed = m is None
    print(("RED %5s" % (failed if not crashed else 'crash'))+" : "+name if (failed or crashed) else "GREEN — NOT CAUGHT : "+name, flush=True)
    if not failed and not crashed: bad+=1
print("cases",lo,"-",min(hi,len(muts)),"of",len(muts),"| not caught / skipped:",bad)
