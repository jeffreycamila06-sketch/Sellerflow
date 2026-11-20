#!/usr/bin/env python3
# On-purpose breaks: each one undoes ONE part of the [SHOPEE-DIAG] counters (or changes what the reader does), runs the
# tests that should catch it, and puts the file back. A break that leaves every test green = that part is not tested.
#   python3 docs/design/shopee-diag/proof/breaks.py   (from the repo root; writes breaks.txt next to it)
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).with_name("breaks.txt")
T = ["src/redesign/adapters/__tests__/shopeeDiag.server.test.ts"]
D = "server/shopeeDiag.js"
L = "server/shopeeLiveLink.js"

BREAKS = [
    ("e2e messages counted as message", D, 'else if (kind === "e2e_message") n.msgs_e2e += list.length;', 'else if (kind === "e2e_message") n.msgs_message += list.length;'),
    ("the system list not counted", D, "      else n.msgs_system += list.length;", "      else n.msgs_system += 0;"),
    ("the host never recognised (every sender = others)", D, 'uid === String(hostUid ?? "") ? "host"', 'false ? "host"'),
    ("a repeat never told from a different message with the same id", D, "if (first !== undefined && first !== sigOf(m)) n.dupe_collide += 1;", "if (false) n.dupe_collide += 1;"),
    ("type taken only from the message, not its content", D, "const t = obj && obj.type != null ? obj.type : msg.type != null ? msg.type : msg.msg_type;", "const t = msg.type != null ? msg.type : msg.msg_type;"),
    ("no line at once for a new shape (60 s only)", D, "if (!shapes.has(shape)) { shapes.add(shape); if (shapeLines < DIAG_SHAPE_LINES_MAX) shapePending = true; }", "if (!shapes.has(shape)) { shapes.add(shape); }"),
    ("the line every 10 min instead of 60 s", D, "export const DIAG_EVERY_MS = 60 * 1000;", "export const DIAG_EVERY_MS = 10 * 60 * 1000;"),
    ("a map keyed by names prints its names", D, "  if (list.length > DIAG_KEYS_MAX) return [`${prefix}many:${list.length}`];\n", ""),
    ("a long number in a field name is printed", D, "&& !/\\d{4,}/.test(s) ? s : \"?\";", "? s : \"?\";"),
    ("the walk misses the array-of-messages batch shape", D, "const msgs = Array.isArray(batch && batch.msgs) ? batch.msgs : Array.isArray(batch) ? batch : [];\n    for (const m of msgs) if (m && typeof m === \"object\") out.push(m);\n  }\n  return out;",
     "const msgs = Array.isArray(batch && batch.msgs) ? batch.msgs : [];\n    for (const m of msgs) if (m && typeof m === \"object\") out.push(m);\n  }\n  return out;"),
    ("no last line at stop", L, "    dg(entry, (d) => log(d.line(entry.sellerId)));\n", ""),
    ("a throw inside the diagnostic reaches the reader", L, "const dg = (entry, fn) => { if (!entry.diag) return; try { fn(entry.diag); } catch { /* diagnostic only */ } };",
     "const dg = (entry, fn) => { if (!entry.diag) return; fn(entry.diag); };"),
    ("the diagnostic changes a comment (adds a field to the payload)", L, "      dg(entry, (d) => d.msg(m, \"kept\", payload.msgId));", "      dg(entry, (d) => { d.msg(m, \"kept\", payload.msgId); payload.diag = 1; });"),
    ("the reader starts reading the system list (a behaviour change)", L, 'for (const kind of ["message", "e2e_message"]) {', 'for (const kind of ["message", "e2e_message", "system"]) {'),
    ("failing polls not counted", L, "    dg(entry, (d) => d.poll());\n", "    if (r.status === 200) dg(entry, (d) => d.poll());\n"),
]

lines, bad = [], 0
for name, rel, old, new in BREAKS:
    f = ROOT / rel
    text = f.read_text(encoding="utf-8")
    if text.count(old) != 1:
        lines.append(f"SETUP ERROR ({text.count(old)} matches): {name}"); bad += 1; continue
    f.write_text(text.replace(old, new), encoding="utf-8")
    try:
        r = subprocess.run(["npx", "vitest", "run", *T], cwd=ROOT, capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr
        failed = [l.strip() for l in out.splitlines() if l.strip().startswith(("×", "✗"))][:3]
        caught = r.returncode != 0
        if not caught: bad += 1
        lines.append(f"{'CAUGHT' if caught else 'NOT CAUGHT'}: {name}" + "".join(f"\n    {x[:150]}" for x in failed))
    finally:
        f.write_text(text, encoding="utf-8")
    print(lines[-1], flush=True)
OUT.write_text("\n".join(lines) + f"\n\n{len(BREAKS) - bad} of {len(BREAKS)} breaks caught\n", encoding="utf-8")
sys.exit(1 if bad else 0)
