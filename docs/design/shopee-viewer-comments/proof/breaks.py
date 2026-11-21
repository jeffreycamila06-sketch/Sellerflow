#!/usr/bin/env python3
# On-purpose breaks: each one undoes ONE part of the type-100 fix (or of its diagnostic), runs the tests that should
# catch it, and puts the file back. A break that leaves every test green = that part is not tested.
#   python3 docs/design/shopee-viewer-comments/proof/breaks.py   (from the repo root; writes breaks.txt next to it)
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).with_name("breaks.txt")
T = ["src/redesign/adapters/__tests__/shopeeViewerComments.server.test.ts", "src/redesign/adapters/__tests__/shopeeDiag.server.test.ts",
     "src/redesign/adapters/__tests__/shopeeLiveLink.server.test.ts"]
D = "server/shopeeDiag.js"
L = "server/shopeeLiveLink.js"

BREAKS = [
    ("type 100 still dropped (main's rule)", L, "type !== SHOPEE_HOST_TEXT_TYPE && type !== SHOPEE_VIEWER_TEXT_TYPE) return \"\";", "type !== SHOPEE_HOST_TEXT_TYPE) return \"\";"),
    ("type 100 kept without a sender uid", L, "    if (!uid || !text.trim()) return \"\";", "    if (!text.trim()) return \"\";"),
    ("type 100 kept with a spaces-only text", L, "    if (!uid || !text.trim()) return \"\";", "    if (!uid || !text) return \"\";"),
    ("the type-100 guard also applied to 101 (a host 101 without uid lost)", L, "  if (type === SHOPEE_VIEWER_TEXT_TYPE) {\n    const uid", "  if (type === SHOPEE_VIEWER_TEXT_TYPE || type === SHOPEE_HOST_TEXT_TYPE) {\n    const uid"),
    ("every type read as text (a type-7 notice becomes a comment)", L, "  if (type !== null && type !== SHOPEE_HOST_TEXT_TYPE && type !== SHOPEE_VIEWER_TEXT_TYPE) return \"\";\n", ""),
    ("type 100 read from a different field (content_v2)", L, "  const text = typeof c.content === \"string\" ? c.content : typeof c.text === \"string\" ? c.text : \"\";",
     "  const text = type === SHOPEE_VIEWER_TEXT_TYPE ? (typeof c.content_v2 === \"string\" ? c.content_v2 : \"\") : typeof c.content === \"string\" ? c.content : typeof c.text === \"string\" ? c.text : \"\";"),
    ("a type-100 comment's text trimmed (payload differs from 101)", L, "  return text;\n}", "  return type === SHOPEE_VIEWER_TEXT_TYPE ? text.trim() : text;\n}"),
    ("kept_100 counts every kept message", D, "      if (s.type === \"100\") n.kept_100 += 1;", "      n.kept_100 += 1;"),
    ("a kept type-100 message also counted as no text (an old counter changes)", D, "      if (s.type === \"100\") n.kept_100 += 1;", "      if (s.type === \"100\") { n.kept_100 += 1; n.dropped_notext += 1; }"),
    ("no line at once for a new type-100 shape", D, "if (shapes100.length < DIAG_100_SHAPES_MAX) { shapes100.push(paths); pending100 = true; }", "if (shapes100.length < DIAG_100_SHAPES_MAX) { shapes100.push(paths); }"),
    ("type-100 shapes share the other shapes' budget", D, "    if (!shapePending && !pending100 && !due) return false;", "    if (!shapePending && !(pending100 && shapeLines < DIAG_SHAPE_LINES_MAX) && !due) return false;"),
    ("no cap on the type-100 shapes listed", D, "export const DIAG_100_SHAPES_MAX = 4; ", "export const DIAG_100_SHAPES_MAX = 400; "),
    ("a field path carries its value", D, "      add(path);\n      if (v && typeof v", "      add(typeof v === \"string\" ? `${path}=${v}` : path);\n      if (v && typeof v"),
    ("a JSON-looking string is walked (a typed comment's words in the log)", D, "      let v = o[k];\n", "      let v = o[k];\n      if (typeof v === \"string\" && v.trim().startsWith(\"{\")) { try { v = JSON.parse(v); } catch { /* */ } }\n"),
    ("a map keyed by names prints its names", D, "    if (names.length > DIAG_KEYS_MAX) { add(`${prefix}many:${names.length}`); return; }\n", ""),
    ("a field name not cleaned (a uid-like name printed)", D, "      const path = `${prefix}${safeKeyName(k)}`;", "      const path = `${prefix}${k}`;"),
    ("no path cap", D, "  const add = (p) => { if (out.length < DIAG_PATHS_MAX) out.push(p); else more += 1; };", "  const add = (p) => { out.push(p); };"),
    ("kept_100 / keys_100 missing from the line", D, "      + ` kept_100=${n.kept_100} keys_100=${keys100()}`;", "      + \"\";"),
]

lines, bad = [], 0
for name, rel, old, new in BREAKS:
    f = ROOT / rel
    text = f.read_text(encoding="utf-8")
    if text.count(old) != 1:
        lines.append(f"SETUP ERROR ({text.count(old)} matches): {name}"); bad += 1; print(lines[-1], flush=True); continue
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
