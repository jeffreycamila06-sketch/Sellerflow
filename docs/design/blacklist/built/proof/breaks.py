# python3 -I docs/design/blacklist/built/proof/breaks.py   (from the repo root; app tests need node_modules,
# the SQL breaks need PGLITE_DIR). Each break changes ONE thing in the built code, runs the tests that should
# catch it, writes CAUGHT / MISSED, and puts the file back exactly as it was.
import os, subprocess, sys, pathlib
root = pathlib.Path(__file__).resolve().parents[5]
os.chdir(root)
T = {
  "rules": "src/redesign/adapters/__tests__/blacklist.test.ts",
  "io": "src/redesign/adapters/__tests__/blacklist.io.test.tsx",
  "screen": "src/redesign/screens/__tests__/Blacklist.test.tsx",
  "live": "src/redesign/screens/__tests__/Dashboard.blacklist.test.tsx",
  "app": "src/redesign/__tests__/blacklist.app.test.tsx",
  "sql": "src/redesign/adapters/__tests__/blacklistSql.test.ts",
  "fence": "src/redesign/__tests__/blacklist.fence.test.ts",
}
A = "src/redesign/adapters/blacklist.ts"
S = "src/redesign/screens/Blacklist.tsx"
D = "src/redesign/screens/Dashboard.tsx"
H = "src/redesign/screens/SettingsHub.tsx"
R = "src/redesign/RedesignApp.tsx"
Q = "sql/190_buyer_blacklist.sql"
BREAKS = [
  ("QR reader also takes a plain word (Parcel Scan's rule)", A, 'const at = s.match(/^@([A-Za-z0-9._]{1,30})$/);', 'const at = s.match(/^@?([A-Za-z0-9._]{1,30})$/);', ["rules"]),
  ("QR reader takes a TikTok VIDEO link", A, '\\/?(?:[?#].*)?$/i);', '(?:\\/.*)?(?:[?#].*)?$/i);', ["rules"]),
  ("Taiwan check removed from the gate", A, 'const outsideTaiwan = a.adminUnion || String(a.country ?? "").trim().toUpperCase() !== "TW";', 'const outsideTaiwan = true;', ["rules", "app"]),
  ("switch / tester / admin ignored (on for everyone outside Taiwan)", A, 'return outsideTaiwan && (a.switchOn || a.isAdmin || a.hasKey);', 'return outsideTaiwan;', ["rules", "app"]),
  ("TikTok key keeps the @", A, 'return platform === "tiktok" ? s.replace(/^@/, "").trim() : s;', 'return s;', ["rules", "io", "live"]),
  ("Facebook matched by the commenter id instead of the name", A, 'return map.get(blMapKey("facebook", blacklistKey("facebook", name))) ?? null;', 'return map.get(blMapKey("facebook", blacklistKey("facebook", c.handle))) ?? null;', ["rules", "live"]),
  ("Instagram comments matched like TikTok", A, '  if (p === "tiktok") {', '  if (p === "tiktok" || p === "instagram") {', ["rules", "live"]),
  ("partial match (a longer username matches)", A, '    return k ? map.get(blMapKey("tiktok", k)) ?? null : null;', '    return k ? [...map.values()].find((e) => e.platform === "tiktok" && k.startsWith(e.key)) ?? null : null;', ["rules", "live"]),
  ("hook reads on a timer (every 10 min)", A, '    if (rise) void reload();\n  }, [live, allowed, reload]);', '    if (rise) void reload();\n    const iv = on ? setInterval(() => void reload(), 600000) : null;\n    return () => { if (iv) clearInterval(iv); };\n  }, [live, allowed, reload]);', ["io", "fence"]),
  # (the "rise" check AND reload() both test the gate: removing the rise check alone changes nothing — reload's own guard is the one to break)
  ("hook reads even with the gate closed", A, '    if (!allowed) return false;\n    const my = ++seq.current;', '    const my = ++seq.current;', ["io"]),
  ("hook also reads when the live STOPS (not only when it starts)", A, '    const rise = on && !wasLive.current;', '    const rise = on !== wasLive.current;', ["io"]),
  ("Undo removes the whole buyer instead of that one row", S, '    const ok = await onUndo(n.id);', '    const ok = await onRemove({ platform: "tiktok", key: n.buyer.replace(/^@/, "").toLowerCase(), label: n.buyer.replace(/^@/, "") } as BlEntry);', ["screen"]),
  ("Remove uses the browser's confirm", S, '<button type="button" onClick={() => { setRemoveFailed(false); setRemoving(e); }} data-testid="bl-remove" style={{ minHeight: 44,', '<button type="button" onClick={() => { if (window.confirm("Remove?")) void onRemove(e); }} data-testid="bl-remove" style={{ minHeight: 44,', ["screen"]),
  ("Add button red", S, '    <button type="submit" disabled={!on || busy || !!problem} data-testid="bl-add"\n            style={{ ...btnPrimary, minWidth: 72,', '    <button type="submit" disabled={!on || busy || !!problem} data-testid="bl-add"\n            style={{ ...btnPrimary, background: "var(--danger)", minWidth: 72,', ["screen"]),
  ("adding allowed before a reason is picked", S, '  const on = reason != null;', '  const on = true;', ["screen"]),
  ("chip moved into the name line", D, '                    {baNear && <span data-testid="ba-chip-amber"', '                    {bl && <span data-testid="bl-chip" style={RISK_CHIP.risky}>⛔ {blacklistChipText(bl, t)}</span>}\n                    {baNear && <span data-testid="ba-chip-amber"', ["live"]),
  ("1-Click skipped for a blacklisted buyer", D, '<button onClick={() => onOneClick(c.id)} title={t.rd_dash_1click_title}', '<button onClick={() => { if (!bl) onOneClick(c.id); }} title={t.rd_dash_1click_title}', ["live"]),
  ("tile placed after Privacy & Terms instead of 3rd", H, '          <Tile icon={ic.doclock} label={t.lg_pt_title} onClick={onLegal} />\n', '          <Tile icon={ic.doclock} label={t.lg_pt_title} onClick={onLegal} />\n          {onBlacklist && <button onClick={onBlacklist} data-testid="tile-blacklist">x</button>}\n', ["app"]),
  ("NEW badge never goes away", R, '    setBlacklistNewSeen(true);\n', '', ["app"]),
  ("SQL: admins may read every seller's list", Q, 'for select to authenticated using (user_id = (select auth.uid()));', 'for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());', ["sql"]),
  ("SQL: once-a-day rule removed", Q, '  add constraint buyer_blacklist_once_a_day      unique (user_id, platform, buyer_key, reason, added_day);', '  add constraint buyer_blacklist_once_a_day      unique (id);', ["sql"]),
  ("SQL: update allowed", Q, 'grant select, insert, delete on table public.buyer_blacklist to authenticated;', 'grant select, insert, update, delete on table public.buyer_blacklist to authenticated;', ["sql"]),
]
def run(keys):
    files = [T[k] for k in keys]
    r = subprocess.run(["npx", "vitest", "run", *files], capture_output=True, text=True)
    return r.returncode != 0, (r.stdout + r.stderr)
out = []
missed = 0
for name, f, old, new, keys in BREAKS:
    src = pathlib.Path(f).read_text()
    if src.count(old) != 1:
        out.append(f"SETUP  {name}: text found {src.count(old)} times"); missed += 1; continue
    pathlib.Path(f).write_text(src.replace(old, new, 1))
    try:
        failed, log = run(keys)
    finally:
        pathlib.Path(f).write_text(src)
    out.append(f"{'CAUGHT' if failed else 'MISSED'} {name}  (tests: {', '.join(keys)})")
    if not failed: missed += 1
    print(out[-1], flush=True)
# the PGlite behaviour script against the same three SQL breaks
pg = os.environ.get("PGLITE_DIR")
if pg:
    for name, f, old, new, keys in [b for b in BREAKS if b[1] == Q]:
        src = pathlib.Path(f).read_text()
        pathlib.Path(f).write_text(src.replace(old, new, 1))
        try:
            r = subprocess.run(["node", "scripts/sql190-behaviour.mjs"], capture_output=True, text=True, env={**os.environ, "PGLITE_DIR": pg})
        finally:
            pathlib.Path(f).write_text(src)
        caught = r.returncode != 0
        out.append(f"{'CAUGHT' if caught else 'MISSED'} {name}  (throw-away database script)")
        if not caught: missed += 1
        print(out[-1], flush=True)
out.append(f"{len(out) - missed} of {len(out)} caught")
print(out[-1])
(pathlib.Path(__file__).parent / "breaks.txt").write_text("\n".join(out) + "\n")
sys.exit(1 if missed else 0)
