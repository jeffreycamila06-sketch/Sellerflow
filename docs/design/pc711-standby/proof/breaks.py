#!/usr/bin/env python3
# On-purpose breaks: each one undoes ONE part of the standby keepalive, runs the tests that should catch it, and puts
# the file back. A break that leaves every test green would mean that part is not tested.
#   python3 docs/design/pc711-standby/proof/breaks.py   (from the repo root; writes breaks.txt next to it)
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).with_name("breaks.txt")
T = "src/redesign/adapters/__tests__/pc711Standby.server.test.ts"
CARD = "src/redesign/components/__tests__/Pc711DutyCard.storeSession.test.tsx"
S = "server/pc711Shadow.js"
E = "server/pc711Emap.js"
D = "server/pc711Duty.js"

BREAKS = [
    ("no standby step at all (main's behaviour)", S,
     'if (!p.shadow) return (await standbyKeep(st)) ? { skipped: "off", standby: true } : { skipped: "off" };', 'if (!p.shadow) return { skipped: "off" };', [T]),
    ("standby also when the backup switch is off", S, "backup.state().enabled === true", "true", [T]),
    ("the keepalive told a store check is waiting (never fires)", S, "await emap.keepalive(false, inShadowMaint(now()));", "await emap.keepalive(true, inShadowMaint(now()));", [T]),
    ("no repair / open on standby", S, "try { await emap.refresh(inShadowMaint(now()), null); } catch { /* never stops the pass */ }\n    return true;", "return true;", [T]),
    ("the shadow's safety brake on standby", S, "await emap.refresh(inShadowMaint(now()), null)", "await emap.refresh(inShadowMaint(now()), openHooks)", [T]),
    ("no open at once after a new login", S, "if (st && st.since !== loginSince) { loginSince = st.since; try { emap.onLogin(); } catch { /* never stops the pass */ } }", "", [T]),
    ("standby ignores the night window (repair / open at night)", S, "try { await emap.refresh(inShadowMaint(now()), null); }", "try { await emap.refresh(false, null); }", [T]),
    ("standby also runs with the shadow switch ON (a second keepalive)", S,
     "    noteStandby(false);\n    const d = taipeiDay(t);", "    await standbyKeep(st);\n    const d = taipeiDay(t);", [T]),
    ("the card word says ready for a stale session", E, 'if (derived === "ok") return "ready";', 'if (derived === "ok" || derived === "stale") return "ready";', [T]),
    ("the duty answer carries the word with the backup off", D, "storeSession: on && DUTY_STORE_SESSION.includes(storeSession) ? storeSession : null,", "storeSession: DUTY_STORE_SESSION.includes(storeSession) ? storeSession : null,", [T]),
    ("the card shows the line with the backup off", "src/redesign/components/Pc711DutyCard.tsx", '{state !== "off" && duty.storeSession ?', "{duty.storeSession ?", [CARD]),
]

lines = []
bad = 0
for name, rel, old, new, tests in BREAKS:
    f = ROOT / rel
    text = f.read_text(encoding="utf-8")
    if text.count(old) != 1:
        lines.append(f"SETUP ERROR ({text.count(old)} matches): {name}")
        bad += 1
        continue
    f.write_text(text.replace(old, new), encoding="utf-8")
    try:
        r = subprocess.run(["npx", "vitest", "run", *tests], cwd=ROOT, capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr
        failed = [l.strip() for l in out.splitlines() if l.strip().startswith(("×", "✗"))][:3]
        caught = r.returncode != 0
        if not caught:
            bad += 1
        lines.append(f"{'CAUGHT' if caught else 'NOT CAUGHT'}: {name}" + "".join(f"\n    {x[:150]}" for x in failed))
    finally:
        f.write_text(text, encoding="utf-8")
    print(lines[-1], flush=True)
OUT.write_text("\n".join(lines) + f"\n\n{len(BREAKS) - bad} of {len(BREAKS)} breaks caught\n", encoding="utf-8")
sys.exit(1 if bad else 0)
