#!/usr/bin/env python3
"""On-purpose breaks for Waybill username: break ONE rule in the real code, run the tests that guard it,
expect RED, put the code back. Every break must be caught. Run from the repo root:
    python3 docs/design/waybill-username/proof/breaks.py > docs/design/waybill-username/proof/breaks.txt
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[4]
A = "src/redesign/adapters/"
T = "src/redesign/adapters/__tests__/"
CSV_T = [T + "waybillCsv.test.ts"]
MATCH_T = [T + "waybillMatch.test.ts"]
ROWS_T = [T + "waybillRows.test.ts"]
PDF_T = [T + "waybillPdf.test.ts"]
GATE_T = [T + "waybillGate.test.ts"]
APP_T = ["src/redesign/__tests__/waybillUsername.app.test.tsx"]
SCREEN_T = ["src/redesign/screens/__tests__/WaybillUsername.test.tsx"]

BREAKS = [
    # (name, file, old, new, tests)
    ("CSV: columns read by position, not by header name", A + "waybillCsv.ts",
     "  const cOrder = findCol(headers, ORDER_HEADERS);", "  const cOrder = 0;", CSV_T),
    ("CSV: the byte-order mark is not removed (neither from the file text nor from the first header)", A + "waybillCsv.ts",
     [('const norm = (s: string): string => s.replace(/^\\uFEFF/, "")', "const norm = (s: string): string => s"),
      ('  const body = String(text ?? "").replace(/^\\uFEFF/, "");', '  const body = String(text ?? "");')], None, CSV_T),
    ("CSV: a comma inside quotes splits the field", A + "waybillCsv.ts",
     '    if (ch === delim) { row.push(field); field = ""; i++; continue; }\n  }',
     '    if (ch === delim) { row.push(field); field = ""; i++; continue; }\n  }', CSV_T),  # placeholder replaced below
    ("CSV: no Buyer Username column is not reported", A + "waybillCsv.ts",
     '  if (cUser < 0) return { ok: false, error: "no_username_col" };', "", CSV_T),
    ("CSV: an order with 2 items is kept twice", A + "waybillCsv.ts",
     "    if (had) {", "    if (had && false) {", CSV_T),
    ("match: the length is not compared", A + "waybillMatch.ts",
     "  if (m.length !== h.length) return false;", "", MATCH_T),
    ("match: capital letters count", A + "waybillMatch.ts",
     "  const m = chars(stripAt(mask).toLowerCase());", "  const m = chars(stripAt(mask));", MATCH_T),
    ("candidates: Facebook / Shopee buyers count too", A + "waybillMatch.ts",
     '    if (String(r.platform ?? "").trim().toLowerCase() !== "tiktok") continue;', "", MATCH_T),
    ("candidates: older days count too", A + "waybillMatch.ts",
     '    const day = r.session_date === today ? "today" : r.session_date === yesterday ? "yesterday" : null;',
     '    const day = r.session_date === today ? "today" : "yesterday";', MATCH_T),
    ("candidates: another seller's rows count", A + "waybillMatch.ts",
     "    if (!r || r.user_id !== userId) continue;", "    if (!r) continue;", MATCH_T),
    ("read: not limited to my rows", A + "waybillMatch.ts",
     '        .eq("user_id", userId)\n', "", MATCH_T),
    ("read: a failed page gives a part of the list", A + "waybillMatch.ts",
     "    if (!rows) return { ok: false };", "    if (!rows) return { ok: true, candidates: [], today };", MATCH_T),
    ("rows: 2 fitting buyers → the first one is used", A + "waybillRows.ts",
     "    if (fit.length === 1) return", "    if (fit.length >= 1) return", ROWS_T + SCREEN_T),
    ("rows: a choice to leave blank is ignored", A + "waybillRows.ts",
     '  if (choice && choice.handle === null) return { ...row, kind: "blank", final: null, picked };', "", ROWS_T + SCREEN_T),
    ("rows: the tracking number fallback is gone", A + "waybillRows.ts",
     " ?? p.words.map((w) => byTracking.get(w)).find(Boolean);", ";", ROWS_T),
    ("PDF: something crossing the free space is not checked", A + "waybillPdfRead.ts",
     '  if (obstacles.some((o) => overlaps(o, slot))) return { ok: false, reason: "no_space" };', "", PDF_T),
    ("PDF: the grey COD watermark counts as something to avoid", A + "waybillPdfRead.ts",
     "    return big && (o.light || /^\\s*cod\\s*$/i.test(o.str));", "    return false;", PDF_T),
    ("PDF: the right edge ignores the barcode column", A + "waybillPdfRead.ts",
     "    if (o.y0 < band.y1 && o.y1 > band.y0 && o.x0 >= left - 0.01 && o.x0 < right) right = o.x0;", "", PDF_T),
    ("PDF: a long username is not made smaller", A + "waybillPdfRead.ts",
     "  const size = Math.min(STAMP_MAX_SIZE, 2 * slot.labelH, byHeight, byWidth);",
     "  const size = Math.min(STAMP_MAX_SIZE, 2 * slot.labelH, byHeight);", PDF_T),
    ("PDF: no smallest readable size", A + "waybillPdfRead.ts",
     "  if (!(size >= STAMP_MIN_SIZE)) return null;", "  if (!(size > 0)) return null;", PDF_T),
    ("PDF: the width is measured with kerning (shorter than it prints)", A + "waybillPdf.ts",
     "  return fitStamp(info.slot.slot, stampWidthAt1(stampText(handle)));",
     "  return fitStamp(info.slot.slot, (widthFont ??= embedder(StandardFonts.HelveticaBold)).widthOfTextAtSize(stampText(handle), 1));", PDF_T),
    ("PDF: the page size is changed", A + "waybillPdf.ts",
     "    page.drawText(stampText(handle),", "    page.setSize(page.getWidth() + 1, page.getHeight());\n    page.drawText(stampText(handle),", PDF_T),
    ("PDF: the stamp is placed at the left of the space (over the values)", A + "waybillPdfRead.ts",
     "  const x = slot.x1 - w; // right side of the space, like the approved picture",
     "  const x = slot.x0 - 40;", PDF_T),
    ("PDF: the order id is not read", A + "waybillPdfRead.ts",
     "      if (m) orderId = m[1].replace(/\\s+/g, \"\");", "", PDF_T),
    ("PDF: text codes read as letters (no ToUnicode)", A + "waybillPdf.ts",
     '      uni: (c) => tu?.map.get(c) ?? "",', "      uni: (c) => String.fromCharCode(c),", PDF_T),
    ("gate: Taiwan gets the full screen", A + "waybillGate.ts",
     '  if (c === "TW") return "soon";', '  if (c === "TW") return "full";', GATE_T + APP_T),
    ("gate: the switch is ignored (always open)", A + "waybillGate.ts",
     "  const open = a.switchOn || a.hasKey || a.isAdmin;", "  const open = true;", GATE_T + APP_T),
    ("gate: other markets see it", A + "waybillGate.ts",
     '  return "hidden";\n}', '  return "full";\n}', GATE_T + APP_T),
    ("Settings: the SHIPPING group shows even when the feature is off", "src/redesign/RedesignApp.tsx",
     "{...(shipHubOn ? { onShippingHub:", "{...(true ? { onShippingHub:", APP_T),
    ("Settings: the old 'Shipping · Coming soon' tile stays next to the new row", "src/redesign/RedesignApp.tsx",
     '              shippingSoon={!shipHubOn && shippingGate === "soon"}', '              shippingSoon={shippingGate === "soon"}', APP_T),
    ("Settings: the NEW badge never goes away", "src/redesign/RedesignApp.tsx",
     "shippingHubNew: !shipHubSeen }", "shippingHubNew: true }", APP_T),
    ("phone: something is awaited before the share (iPhone loses the tap)", "src/redesign/screens/WaybillUsername.tsx",
     "      const share = deliverXlsmMobile(out, name, \"application/pdf\");",
     "      const share = Promise.resolve().then(() => deliverXlsmMobile(out, name, \"application/pdf\"));", SCREEN_T),
    ("screen: Add usernames is on before both files are in", "src/redesign/screens/WaybillUsername.tsx",
     "  const ready = !!orders && !!pages && !!buyers;", "  const ready = true;", SCREEN_T),
]

# the "comma inside quotes" break: treat a quote as a plain letter
BREAKS[2] = ("CSV: a comma inside quotes splits the field", A + "waybillCsv.ts",
             '    if (ch === "\\"" && field === "") { quoted = true; i++; continue; }', "", CSV_T)


def run(tests):
    r = subprocess.run(["npx", "vitest", "run", *tests], cwd=ROOT, capture_output=True, text=True, timeout=600)
    return r.returncode, r.stdout + r.stderr


def main():
    caught = 0
    only = sys.argv[1:]  # optional: run only the breaks whose name contains one of these words
    todo = [b for b in BREAKS if not only or any(w in b[0] for w in only)]
    for name, f, old, new, tests in todo:
        p = ROOT / f
        src = p.read_text(encoding="utf-8")
        edits = old if isinstance(old, list) else [(old, new)]
        broken = src
        if any(src.count(o) != 1 for o, _ in edits):
            print(f"SETUP  {name}: the line to break is not found exactly once in {f}")
            continue
        for o, n in edits:
            broken = broken.replace(o, n)
        p.write_text(broken, encoding="utf-8")
        try:
            code, out = run(tests)
        finally:
            p.write_text(src, encoding="utf-8")
        failed = [l.strip() for l in out.splitlines() if l.strip().startswith(("×", "✗"))][:2]
        if code != 0:
            caught += 1
            print(f"CAUGHT {name}\n       red: {' | '.join(failed) or '(the test file failed)'}")
        else:
            print(f"MISSED {name}")
    print(f"\n{caught} of {len(todo)} breaks caught")
    code, _ = run(CSV_T + MATCH_T + ROWS_T + PDF_T + GATE_T + APP_T + SCREEN_T)
    print("after putting everything back: " + ("all green" if code == 0 else "RED — something was not restored"))
    sys.exit(0 if caught == len(todo) and code == 0 else 1)


if __name__ == "__main__":
    main()
