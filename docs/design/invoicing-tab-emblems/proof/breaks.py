# Changes made ON PURPOSE in a throw-away copy of the branch, one at a time; each must turn a test red.
#   python3 docs/design/invoicing-tab-emblems/proof/breaks.py <copy of the repo with node_modules>
import subprocess, sys, re
root = sys.argv[1]
LP = "src/redesign/adapters/livePicker.ts"; D = "src/redesign/screens/Dashboard.tsx"; I = "src/redesign/screens/Invoicing.tsx"
E = "src/redesign/components/PlatformEmblem.tsx"; C = "src/redesign/redesign.css"
T = "src/redesign/screens/__tests__/Invoicing.tabEmblems.test.tsx"; TP = "src/redesign/screens/__tests__/Dashboard.livePicker.test.tsx"
BREAKS = [
  ("the Live picker's TikTok letter changes", LP, 'TikTok: "t", Facebook: "f"', 'TikTok: "T", Facebook: "f"', [T]),
  ("the Live picker's Facebook colour changes", LP, 'Facebook: "#1877f2"', 'Facebook: "#1877f3"', [T]),
  ("the shared emblem gets another class (the picker would look different)", E, '<span className={`sfl-lpk-shape sfl-lpk-shape--${EMBLEM_SLUG[platform]}`}', '<span className={`sfl-lpk-shape sfl-lpk-shape--${EMBLEM_SLUG[platform]} small`}', [T]),
  ("the Dashboard draws its own emblem again", D, 'const lpkEmblem = (p: PickerPlatform) => <PlatformEmblem platform={p} />;', 'const lpkEmblem = (p: PickerPlatform) => <span className={`sfl-lpk-shape sfl-lpk-shape--${lpkSlug[p]}`}><span className="sfl-lpk-letter">{p[0]}</span></span>;', [T]),
  ("a tab draws its own emblem instead of the shared one", I, '<PlatformEmblem platform={brand} /></span>', '<span className="sfl-lpk-shape"><span className="sfl-lpk-letter">{PLATFORM_NAME[p][0]}</span></span></span>', [T]),
  ("a LIVE tag on the tabs", I, '<span data-testid={`ivc-tab-name-${p}`}', '<span className="sfl-lpk-tag">LIVE</span><span data-testid={`ivc-tab-name-${p}`}', [T]),
  ("the name above the emblem", I, 'flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, minHeight: 56', 'flexDirection: "column-reverse", alignItems: "center", justifyContent: "center", gap: 3, minHeight: 56', [T]),
  ("the selected outline is 1px", I, 'border: `2px solid ${on ? emblemOutline(brand) : "transparent"}`', 'border: `1px solid ${on ? emblemOutline(brand) : "transparent"}`', [T]),
  ("the selected outline is the app's accent colour, not the platform's", I, 'border: `2px solid ${on ? emblemOutline(brand) : "transparent"}`', 'border: `2px solid ${on ? "var(--accent)" : "transparent"}`', [T]),
  ("TikTok's outline is plain black (unseen in the dark theme)", LP, '(p === "TikTok" ? "var(--text)" : EMBLEM_BRAND[p])', '(EMBLEM_BRAND[p])', [T]),
  ("the selected tab has no card background", I, 'background: on ? "var(--surface)" : "transparent", color: on ? "var(--text)" : "var(--text-muted)", boxShadow: on ? "var(--shadow)" : "none", cursor', 'background: "transparent", color: on ? "var(--text)" : "var(--text-muted)", boxShadow: on ? "var(--shadow)" : "none", cursor', [T]),
  ("a tab is under 44px", I, 'gap: 3, minHeight: 56', 'gap: 3, minHeight: 40', [T]),
  ("the emblem is read out by a screen reader", I, '<span aria-hidden="true" data-testid={`ivc-tab-emblem-${p}`}', '<span data-testid={`ivc-tab-emblem-${p}`}', [T]),
  ("the tabs use other durations than the picker", LP, '"--lpk-fb": `${LIVE_PICKER_TIMING.idle.Facebook}ms`,\n    "--lpk-ig"', '"--lpk-fb": `${LIVE_PICKER_TIMING.idle.Facebook + 1}ms`,\n    "--lpk-ig"', [T]),
  ("the tab bar ignores the picker's motion mode", I, 'className={`sfl-ivc-tabs sfl-ivc-tabs--m-${LIVE_PICKER_MOTION}`}', 'className="sfl-ivc-tabs"', [T]),
  ("reduce motion no longer stops the tabs", C, '  [data-redesign] .sfl-ivc-tabs, [data-redesign] .sfl-ivc-tabs * { animation: none !important; transition: none !important; }\n', '', [T]),
  ("the app's motion switch no longer stops the tabs", C, '[data-redesign][data-motion="off"] .sfl-ivc-tabs, [data-redesign][data-motion="off"] .sfl-ivc-tabs * { animation: none !important; transition: none !important; }\n', '', [T]),
  ("the selected tab moves as slowly as the others", C, '[data-redesign] .sfl-ivc-tabs:not(.sfl-ivc-tabs--m-off) .sfl-ivc-tab.is-on .sfl-lpk-emb--ig { animation-duration: var(--lpk-ig); }\n', '', [T]),
  ("the tabs get their own new keyframes", C, '[data-redesign] .sfl-ivc-tabs { --ivc-calm: 2.5; }', '@keyframes sflIvcSpin{to{transform:rotate(360deg)}}\n[data-redesign] .sfl-ivc-tabs { --ivc-calm: 2.5; }', [T]),
  ("the tabs restyle the picker's shapes", C, '[data-redesign] .sfl-ivc-tab:focus-visible {', '[data-redesign] .sfl-ivc-tab .sfl-lpk-shape { border-radius: 4px; }\n[data-redesign] .sfl-ivc-tab:focus-visible {', [T]),
  ("a picker animation rule is edited", C, '.sfl-lpk-tile:not(:disabled) .sfl-lpk-emb--sh { animation: sflLpkFlip var(--lpk-sh) ease-in-out var(--lpk-iter); }', '.sfl-lpk-tile:not(:disabled) .sfl-lpk-emb--sh { animation: sflLpkFlip calc(var(--lpk-sh) * 2) ease-in-out var(--lpk-iter); }', [T, TP]),
]
caught = 0
out = []
for name, f, old, new, tests in BREAKS:
    p = f"{root}/{f}"
    src = open(p).read()
    if src.count(old) != 1:
        out.append(f"SKIP  {name}: the text to change was found {src.count(old)} times in {f}"); continue
    open(p, "w").write(src.replace(old, new))
    try:
        r = subprocess.run(["npx", "vitest", "run", *tests], cwd=root, capture_output=True, text=True)
        txt = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
        m = re.search(r"Tests\s+(\d+) failed", txt)
        failed = int(m.group(1)) if m else 0
        first = re.search(r"FAIL\s+\S+ > (.+)", txt)
    finally:
        open(p, "w").write(src)
    if r.returncode != 0 and failed:
        caught += 1
        out.append(f"caught  {name}  →  {failed} test(s) red, e.g. \"{first.group(1).strip()[:110] if first else '?'}\"")
    else:
        out.append(f"MISSED  {name}")
out.append("")
out.append(f"{caught} of {len(BREAKS)} caught")
print("\n".join(out))
