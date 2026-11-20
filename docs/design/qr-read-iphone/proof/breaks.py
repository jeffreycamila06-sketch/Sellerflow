#!/usr/bin/env python3
# On-purpose breaks: each one undoes ONE part of the QR fix, runs the tests that should catch it, and puts the
# file back. A break that leaves every test green would mean that part is not tested.
#   python3 docs/design/qr-read-iphone/proof/breaks.py   (from the repo root; writes breaks.txt next to it)
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).with_name("breaks.txt")
PHOTOS = "src/redesign/adapters/__tests__/qrRead.photos.test.ts"
PATHS = "src/redesign/adapters/__tests__/qrRead.paths.test.ts"
SCREENS = ["src/redesign/screens/__tests__/ParcelScan.qr.test.tsx", "src/redesign/screens/__tests__/FmParcelScan.test.tsx", "src/redesign/screens/__tests__/Blacklist.test.tsx"]
Q = "src/redesign/adapters/qrDecode.ts"

BREAKS = [
    ("two DIFFERENT codes counted as one (a guess)", Q,
     'if (set.size === 1) return { kind: "one", text: [...set][0] };', 'if (set.size >= 1) return { kind: "one", text: [...set][0] };', [PHOTOS, PATHS]),
    ("the stronger reader returns only 1 code per look", Q, "maxNumberOfSymbols: 8", "maxNumberOfSymbols: 1", [PHOTOS]),
    ("no parts of the photo (whole photo only)", Q,
     '{ name: "quadrants", tiles: [[0, 0, 0.6, 0.6], [0.4, 0, 0.6, 0.6], [0, 0.4, 0.6, 0.6], [0.4, 0.4, 0.6, 0.6], [0.2, 0.2, 0.6, 0.6]] },', "", [PHOTOS]),
    ("the photo read at 1000 px like main (not 2400)", Q, "const BASE_EDGE = 2400;", "const BASE_EDGE = 1000;", [PHOTOS]),
    ("a canvas bigger than the iPhone-safe size", Q, "const TILE_EDGE = 2400;", "const TILE_EDGE = 4000;", [PHOTOS]),
    ("jsQR fallback answers its first hit (no check for a 2nd sticker)", Q,
     "if (zx || j.kind !== \"one\") return done(j as QrOutcome);", "if (true) return done(j as QrOutcome);", [PATHS]),
    ("no stronger reader at all (jsQR only, as main)", Q,
     'const [mod, src] = await Promise.all([import("zxing-wasm/reader"), import("./qrWasm")]);',
     'const [mod, src] = await Promise.all([import("zxing-wasm/reader"), import("./qrWasm")]); throw new Error("off" + String(!!mod && !!src));', [PHOTOS]),
    ("the phone's own reader skipped (Android)", Q, 'if (typeof BD === "function") {\n      diag.decoder = "native";', 'if (false) {\n      diag.decoder = "native";', [PATHS]),
    ("the event carries the QR text", Q, "passes: d.passes.map((p) => `${p.pass}:${p.found}:${p.ms}`).join(\",\"),",
     "passes: d.passes.map((p) => `${p.pass}:${p.found}:${p.ms}`).join(\",\"), text: r.kind === \"one\" ? r.text : null,", [PATHS]),
    ("the reason is not recorded (every none = no_code)", Q,
     'if (!src) return done({ kind: "none", reason: "image_unreadable" });', 'if (!src) return done({ kind: "none", reason: "no_code" });', [PATHS]),
    ("Scan does not start loading the reader", Q, "try { if (!hasNativeReader()) void loadZxing(); } catch { /* ignore */ }", "/* off */", [PATHS]),
    ("7-11 screen: 2 stickers shown as No QR found", "src/redesign/screens/ParcelScan.tsx",
     'setToast(tpl(t.rd_qr_many, { n: String(read.count) })); later(() => setToast(""), 3500);', 'setToast(t.rd_ps2_qr_none); later(() => setToast(""), 3500);', SCREENS[:1]),
    ("FamilyMart screen: 2 stickers shown as No QR found", "src/redesign/screens/FmParcelScan.tsx",
     'else if (read.kind === "many") flash(tpl(t.rd_qr_many, { n: String(read.count) }));', 'else if (read.kind === "many") flash(t.rd_ps2_qr_none);', SCREENS[1:2]),
    ("Blacklist: 2 stickers shown as No QR found", "src/redesign/screens/Blacklist.tsx",
     'if (read.kind === "many") { setNote({ kind: "many", count: read.count }); return; }', 'if (read.kind === "many") { setNote({ kind: "noqrfound" }); return; }', SCREENS[2:]),
    # the Scan button of the manual-entry form (the one sellers use; the camera screen's twin is hidden for everyone)
    ("7-11 Scan button does not start loading the reader", "src/redesign/screens/ParcelScan.tsx",
     "onClick={() => { warmQrReader(); qrRef.current?.click(); }} disabled={qrBusy} style={{ padding: \"5px 10px\"",
     "onClick={() => { qrRef.current?.click(); }} disabled={qrBusy} style={{ padding: \"5px 10px\"", SCREENS[:1]),
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
