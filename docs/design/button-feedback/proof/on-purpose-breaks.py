# On-purpose breaks: each one must turn the button-feedback tests red. Files are restored after each.
import subprocess, shutil, sys
import os
R=os.getcwd()+'/'   # run from the repo root
BF='src/redesign/adapters/buttonFeedback.ts'; WE='src/redesign/screens/WebsiteEditor.tsx'; WP='src/redesign/screens/WebsitePayShip.tsx'; GS='src/redesign/screens/GeneralSettings.tsx'; WO='src/redesign/screens/WebsiteOrders.tsx'; CB='src/redesign/components/CopyButton.tsx'; SB='src/redesign/components/SaveButton.tsx'; CF='src/redesign/components/CopyFailNote.tsx'
BREAKS=[
 ("copy says Copied even when the clipboard refused", BF, 'if (ok) {\n      setFailedText("");', 'if (ok || true) {\n      setFailedText("");'),
 ("✓ Copied never goes back to Copy", BF, 'later(() => { if (turn.current === mine) setPhase("idle"); }, FEEDBACK_MS);\n    } else', '\n    } else'),
 ("refused copy shows nothing", CF, 'if (!failed) return null;', 'if (failed || !failed) return null;'),
 ("the refused text is not selected", CF, 'useEffect(() => { if (failed) selectAll(box.current); }, [failed, text]);', ''),
 ("double tap sends two saves", BF, 'if (flying.current) return; // a second tap while saving: one request only', ''),
 ("unchanged form still offers Save", BF, 'if (dirty === false) return { look: "clean", disabled: true };', ''),
 ("a failed save looks like a saved one", BF, 'else setPhase(r === "blocked" ? "idle" : "failed");', 'else setPhase(r === "blocked" ? "idle" : "done");'),
 ("a missing field turns the button red", BF, 'else setPhase(r === "blocked" ? "idle" : "failed");', 'else setPhase("failed");'),
 ("✓ Saved never ends", BF, 'if (r === true) { setPhase("done"); later(() => { if (turn.current === mine) setPhase("idle"); }, FEEDBACK_MS); }', 'if (r === true) { setPhase("done"); }'),
 ("Saving… stays tappable", BF, 'if (phase === "saving") return { look: "saving", disabled: true };', 'if (phase === "saving") return { look: "saving", disabled: false };'),
 ("an edit during ✓ Saved is swallowed", BF, 'if (phase === "done" && dirty !== true)', 'if (phase === "done")'),
 ("Website: Copy toasts 'Copied' without checking (the old code)", WE, '<CopyButton fb={copyFb} text={link} label={t.rd_shop_od_copy} t={t} testid="wed-copy" style={{ ...smallBtn, minHeight: 44 }} />', '<button type="button" data-testid="wed-copy" style={smallBtn} onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); onToast(t.rd_shop_od_copied); }}>{t.rd_shop_od_copy}</button>'),
 ("Website: Save is always offered (no 'Saved')", WE, 'dirty={dirty} disabled={!!busy} onSave={() => save()}', 'dirty={true} disabled={!!busy} onSave={() => save()}'),
 ("Website: a failed save is reported as blocked (no red)", WE, 'setMsg({ text: t.rd_wed_save_failed, tone: "bad" });\n      return false;', 'setMsg({ text: t.rd_wed_save_failed, tone: "bad" });\n      return "blocked";'),
 ("Payment: Save never says Saved", WP, 'if (ok) setSavedKey(fullKey);', ''),
 ("Profile: a failed save says ✓ Saved", GS, 'setSaveState("error"); setSaveErr(t.rd_set_profile_save_failed); // never the raw database text\n    return false;', 'setSaveState("error"); setSaveErr(t.rd_set_profile_save_failed); // never the raw database text\n    return true;'),
 ("Order link: the fail note is gone", WO, '<CopyFailNote fb={copyFb} t={t} what="link" testid="wor-copy-fail" style={{ marginTop: 0 }} />', ''),
 ("green is not on the saved button", SB, 's.look === "done" ? { background: FB_GREEN,', 's.look === "done" ? { background: "transparent",'),
]
bad=0
for name,f,a,b in BREAKS:
    src=open(R+f,encoding='utf8').read()
    if src.count(a)!=1: print("SETUP PROBLEM", name, src.count(a)); bad+=1; continue
    open(R+f,'w',encoding='utf8').write(src.replace(a,b))
    try:
        r=subprocess.run(['npx','vitest','run','src/redesign/adapters/__tests__/buttonFeedback.test.tsx','src/redesign/screens/__tests__/buttonFeedback.screens.test.tsx'],cwd=R,capture_output=True,text=True,timeout=300)
    finally:
        open(R+f,'w',encoding='utf8').write(src)
    out=r.stdout+r.stderr
    import re
    m=re.search(r'Tests\s+(\d+) failed',out)
    caught = r.returncode!=0 and (m is not None or 'error' in out.lower())
    print(("CAUGHT  " if caught else "MISSED  ")+name+(f"  ({m.group(1)} tests red)" if m else "  (build error)" if caught else ""))
    if not caught: bad+=1
print(f"{len(BREAKS)-bad}/{len(BREAKS)} caught")
sys.exit(1 if bad else 0)
