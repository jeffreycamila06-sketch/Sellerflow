# on-purpose breaks: each one changes ONE thing back, runs the proof, and expects it to FAIL. Files are restored after each.
import subprocess, shutil, os, sys
PG = sys.argv[1]
out = []
def run(cmd, env=None):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, env={**os.environ, **(env or {})})
    return r.returncode, (r.stdout + r.stderr)
def brk(name, path, a, b, cmd, env=None, want=None):
    src = open(path).read()
    assert src.count(a) == 1, (name, src.count(a))
    shutil.copy(path, path + ".bak")
    open(path, "w").write(src.replace(a, b))
    try:
        code, text = run(cmd, env)
    finally:
        shutil.move(path + ".bak", path)
    fails = [l.strip() for l in text.split("\n") if l.startswith("FAIL") or " × " in l or l.strip().startswith("×")]
    behaviour = [f for f in fails if "= this file's text" not in f and "twice" not in f and "applies again" not in f]
    ok = code != 0 and len(behaviour) > 0 and (want is None or any(want in f for f in behaviour))
    out.append(f"{'CAUGHT ' if ok else 'MISSED '} {name}\n" + "\n".join("           " + f[:170] for f in behaviour[:3]))
    print(out[-1], flush=True)
SQL = "sql/216_free_no_account_lock.sql"
PGL = f"node scripts/sql216-behaviour.mjs"
E = {"PGLITE_DIR": PG}
brk("SQL: the swapped-in account gets a lock again (guard)", SQL, "case when v_repl and not public.account_no_lock(v_plan) then", "case when v_repl then", PGL, E, "FREE")
brk("SQL: touch_tiktok_slot refuses a free seller again", SQL, "IF NOT is_admin_caller AND EXISTS (SELECT 1 FROM public.seller_profiles sp\n                                      WHERE sp.auth_user_id = uid AND public.account_no_lock(sp.plan)) THEN", "IF false THEN", PGL, E, "FREE")
brk("SQL: a free seller's change time is kept (no delete)", SQL, "    DELETE FROM public.tiktok_account_changes\n     WHERE user_id = uid AND platform = p_platform AND slot_index = p_slot_index;\n    RETURN now();", "    INSERT INTO public.tiktok_account_changes (user_id, platform, slot_index, last_changed_at) VALUES (uid, p_platform, p_slot_index, now()) ON CONFLICT (user_id, platform, slot_index) DO UPDATE SET last_changed_at = now();\n    RETURN now();", PGL, E, "UPGRADE")
brk("SQL: tiktok_slot_cooldowns still shows a free seller's wait", SQL, "AND public.account_no_lock(sp.plan));", "AND false);", PGL, E)
brk("SQL: a lock left from a paid time still holds a place (account_locked_seats)", SQL, "where sp.auth_user_id = p_user and public.account_no_lock(sp.plan)) then 0 else (", "where sp.auth_user_id = p_user and false) then 0 else (", PGL, E)
brk("SQL: my_account_list still sends the lock time to a free seller", SQL, "case when v_unl or v_free then null else (", "case when v_unl then null else (", PGL, E)
brk("SQL: account_quota still counts a held place for a free seller", SQL, "  if public.account_no_lock(v_plan) then v_lock := 0; v_next := null; end if;   -- sql/216: Free plan → no held place", "", PGL, E)
brk("SQL: 'basic' counts as free (a paid seller would lose the lock)", SQL, "select lower(btrim(coalesce(p_plan, ''))) = 'free';", "select lower(btrim(coalesce(p_plan, ''))) in ('free', 'basic');", PGL, E, "PAID")
brk("SQL: the plan is taken from the row the app sends (p_row_plan)", SQL, "case when v_repl and not public.account_no_lock(v_plan) then", "case when v_repl and not public.account_no_lock(coalesce(p_row_plan, v_plan)) then", "npx vitest run src/redesign/adapters/__tests__/freeNoAccountLockSql.test.ts")
VT = "npx vitest run src/redesign/screens/__tests__/ManageChannels.freeNoLock.test.tsx src/redesign/__tests__/freeNoLock.test.tsx"
brk("APP: a free seller sees LOCKED while the answer loads", "src/redesign/adapters/useChannelEditor.ts", "if (!cooldown && isFree) return", "if (false) return", VT)
brk("APP: the app overrules a wait the server answered (free label wins)", "src/redesign/adapters/useChannelEditor.ts", "if (!cooldown && isFree) return", "if (isFree) return", VT)
brk("APP: a paid seller also gets Change while loading", "src/redesign/adapters/useChannelEditor.ts", "const isFree = isFreePlan(account?.plan);", "const isFree = true;", VT)
brk("APP: Remove on a free seller's account says 'Wait a little'", "src/redesign/adapters/planFull.ts", "|| list.unlimited || list.noLock) return null;", "|| list.unlimited) return null;", VT)
brk("APP: a held place makes a free seller wait", "src/redesign/adapters/planFull.ts", "  if (list?.noLock) return null;                       // sql/216: Free plan → never a wait\n", "", VT)
brk("APP: the popup's note still names the 4 hours", "src/redesign/adapters/planFull.ts", "const lock = lockNoteText(list, t);", "const lock = t.rd_pf_lock_note;", VT)
brk("APP: the Remove question still names the 4 hours (popup)", "src/redesign/components/PlanFullPopup.tsx", "{lead(removeBodyText(list, t))}", "{lead(t.rd_pf_rm_body)}", VT)
brk("APP: the Shopee shops note still names the 4 hours", "src/redesign/screens/ShopeeShops.tsx", "{lockNoteText(list, t)}", "{t.rd_pf_lock_note}", VT)
brk("APP: no_lock read loosely (any truthy value)", "src/redesign/adapters/planFull.ts", "noLock: d.no_lock === true,", "noLock: !!d.no_lock,", VT)
brk("GUIDE: sql/217 without the sentence in one row", "sql/217_guide_free_no_account_lock.sql", "means the 4 hours are not over.\n- On the Free plan you can change or remove your account at any time.", "means the 4 hours are not over.", "npx vitest run src/redesign/adapters/__tests__/freeNoAccountLockSql.test.ts")
caught = sum(1 for o in out if o.startswith("CAUGHT"))
open("docs/design/free-no-account-lock/proof/on-purpose-breaks.txt", "w").write("\n".join(out) + f"\n\n{caught} of {len(out)} on-purpose breaks caught\n")
print(f"\n{caught} of {len(out)} caught")
