# Changes made ON PURPOSE in a throw-away copy of the branch, one at a time; each must turn a test red.
#   python3 docs/design/invoicing-tiktok/proof/breaks.py <copy of the repo with node_modules>
import subprocess, sys, re
root = sys.argv[1]
A = "src/redesign/adapters/invoicing.ts"; S = "src/redesign/screens/Invoicing.tsx"; SH = "src/redesign/components/TikTokSendSheet.tsx"
T = "src/redesign/adapters/__tests__/invoicing.test.ts"; TS = "src/redesign/screens/__tests__/Invoicing.test.tsx"
TQ = "src/redesign/adapters/__tests__/invoicingSql.test.ts"; TG = "src/redesign/adapters/__tests__/invoicingGuideSql.test.ts"
TN = "src/redesign/screens/__tests__/Invoicing.sessions.test.tsx"; TP = "src/redesign/screens/__tests__/pastSessions.test.tsx"; APP = "src/redesign/RedesignApp.tsx"
TA = "src/redesign/__tests__/invoicingOpen.app.test.tsx"; TOFF = "src/redesign/__tests__/invoicing.app.test.tsx"; TH = "src/redesign/screens/__tests__/SettingsHub.invoicing.test.tsx"
BREAKS = [
  ("Can't message buyers stay in Send next", A, '["not_sent", "new_item"].includes(', '["not_sent", "new_item", "skipped"].includes(', [T, TS]),
  ("a later order does not show New item", A, 'return saved.hash === row.hash ? "sent" : "new_item";', 'return "sent";', [T, TS]),
  ("Facebook buyers get into the TikTok list", A, '      if (receipt.platform !== name) return;\n', '', [T, TS]),
  ("rows not in buyer-number order", A, '.sort((a, b) => a - b);', '.sort((a, b) => b - a);', [T, TS]),
  ("the shipping fee is left out of the row total", A, 'total: messageTotal(lines, null, fee),', 'total: messageTotal(lines, null, ""),', [T, TS]),
  ("the lines code changes with the shipping fee", A, 'hash: linesHashOf(receipt),', 'hash: linesHashOf(receipt) + (fee ? "f" : ""),', [T]),
  ("the switch alone does not open Invoicing", A, 'a.switchOn || a.isAdmin || a.previewKey', 'a.isAdmin || a.previewKey', [T, TA]),
  ("the status read has no seller filter", A, '        .eq("user_id", uid).eq("session_key", sessionKey)', '        .eq("session_key", sessionKey)', [TS]),
  ("something more than the status is saved with a buyer", A, 'buyer_key: row.key, status,', 'buyer_key: row.key, note: "x", status,', [TS]),
  ("the Format save also writes the receipt's opening text", A, 'user_id: uid, note: f.note.slice(0, NOTE_MAX), invoice_shipping_fee: fee,', 'user_id: uid, opening: "", note: f.note.slice(0, NOTE_MAX), invoice_shipping_fee: fee,', [TS]),
  ("Send next does not mark the buyer before", S, '    if (pending) status.mark(pending, "sent");\n', '', [TS, TA]),
  ("a double tap on Send next marks the buyer Sent", S, 'if (nowMs - lastTap.current < tapGuardMs) { e.preventDefault(); return; }', 'if (nowMs < 0) { e.preventDefault(); return; }', [TS]),
  ("a number-only id gets a profile link", S, 'const nextTarget = next ? chaseTarget(next.receipt.handle) : null;', 'const nextTarget = next ? { kind: "open" as const, url: `https://www.tiktok.com/@${next.receipt.handle}` } : null;', [TS]),
  ("the status ignores the session", S, 'useInvoiceStatus(activeKey, "tiktok", true)', 'useInvoiceStatus("same", "tiktok", true)', [TS, TN]),
  ("Send works before the format was read", S, 'const ready = status.state === "ready" && fmtState === "ready" && pastState === "ready";', 'const ready = status.state === "ready" && pastState === "ready";', [TS]),
  ("the Facebook tab always shows Receipt format", S, '{p === "facebook" && onReceiptFormat && (', '{p === "facebook" && (', [TS]),
  ("the row sheet marks Sent although the copy failed", SH, '      if (ok) { setStatus(okText); invoice?.onSent(); return; }', '      invoice?.onSent();\n      if (ok) { setStatus(okText); return; }', [TS]),
  ("the row sheet overwrites Send to TikTok's remembered note", SH, 'if (!invoice) saveSendNote(sellerId, note);', 'saveSendNote(sellerId, note);', [TS]),
  ("the row sheet ignores the format's shipping fee", SH, 'useState(invoice?.shipping ?? "")', 'useState("")', [TS]),
  # ── the follow-ups of 2026-11-26: the session picker, copy failed = not sent ──
  ("a refused copy still counts as 'being sent'", S, 'if (ok) { setCopyFailed(key, null); setPending(key, row.id); }', 'setPending(key, row.id); if (ok) setCopyFailed(key, null);', [TN]),
  ("the button moves on after a refused copy", A, '  if (failed) return { row: failed, again: true };\n', '', [T, TN]),
  ("a buyer already Sent turns into Copy failed", A, '  if (row.id === copyFailedId && s !== "sent") return "copy_failed";', '  if (row.id === copyFailedId) return "copy_failed";', [T, TN]),
  ("the row sheet does not report a refused copy", SH, '      invoice?.onCopyFailed?.();\n', '', [TN]),
  ("'Copy failed' survives a copy that worked", S, 'if (ok) { setCopyFailed(key, null); setPending(key, row.id); }', 'if (ok) { setPending(key, row.id); }', [TN]),
  ("Invoicing asks the old-session question", SH, 'const [oldOk, setOldOk] = useState(!pastRange);', 'const [oldOk, setOldOk] = useState(!(pastRange || invoice?.pastRange));', [TN]),
  ("Orders loses its old-session question", SH, 'const [oldOk, setOldOk] = useState(!pastRange);', 'const [oldOk, setOldOk] = useState(true);', [TN, TP]),
  ("a past session is saved under the running session", S, 'const activeKey = pastSel ? pastSel.id : sessionKey;', 'const activeKey = sessionKey;', [TN, TA]),
  ("a past session lists the running session's buyers", S, 'const shownBuyers = pastSel ? past.buyers : buyers;', 'const shownBuyers = buyers;', [TN]),
  ("the old session's tags show while the new one loads", A, '  if (loadedFor !== `${sessionKey}|${platform}`) return { state: "loading", saved: NO_SAVED, unsaved: 0, mark, retry, reload };\n', '', [TN]),
  ("'Sending…' is one for all sessions", A, 'const pendingSlot = (sessionKey: string, platform: InvoicePlatform) => `${platform}|${sessionKey}`;', 'const pendingSlot = (_sessionKey: string, platform: InvoicePlatform) => `${platform}`;', [T, TN]),
  ("a past session's message carries today's date", S, 'const dateOf = (r: InvoiceRow) => (pastSel ? pastRange : currentSessionDate(', 'const dateOf = (r: InvoiceRow) => (!r ? pastRange : currentSessionDate(', [TN]),
  ("the past session button is not amber", S, 'style={pastSel ? { ...pickBtn, ...AMBER } : pickBtn}>', 'style={pickBtn}>', [TN]),
  ("the picker is there without past sessions", S, 'const picker = pastSessions && (', 'const picker = !!sellerId && (', [TN, TA]),
  ("the picker reads the list before it is opened", S, 'const pastSel = past.selected;', 'const pastSel = past.selected; useEffect(() => { void past.ensureList(); }, [past.ensureList]);', [TN]),
  ("the app gives every seller the picker", APP, 'sessionId={sessionInstance.currentSessionId} pastSessions={pastSessionsAllowed(isAdmin, hasFeature("tiktok_send"), featureSw.pastSessionsPublic)}\n              {...(fbReceiptUi', 'sessionId={sessionInstance.currentSessionId} pastSessions\n              {...(fbReceiptUi', [TA, TP]),
  ("Invoicing is open with the switch off", "src/redesign/RedesignApp.tsx", 'const invoicingOn = invoicingVisible({ isAdmin, previewKey: hasFeature("invoicing"), switchOn: featureSw.invoicing });', 'const invoicingOn = true;', [TA, TOFF]),
  ("the Settings card loses Soon for everyone", "src/redesign/screens/SettingsHub.tsx", 'invoicingOpen = false,', 'invoicingOpen = true,', [TH, TOFF]),
  ("sql/220: every signed-in seller can read every row", "sql/220_invoicing.sql", "for select to authenticated using (user_id = (select auth.uid()))", "for select to authenticated using (true)", [TQ]),
  ("sql/220: the switch is created on", "sql/220_invoicing.sql", "values ('invoicing_enabled', 'false')", "values ('invoicing_enabled', 'true')", [TQ]),
  ("sql/220: the clean-up removes rows after 1 month", "sql/220_invoicing.sql", "where updated_at < now() - interval '3 months'", "where updated_at < now() - interval '1 month'", [TQ]),
  ("sql/220: the buyer mark column accepts any text", "sql/220_invoicing.sql", "check (buyer_key ~ '^[0-9a-z]{0,24}$')", "check (char_length(buyer_key) <= 200)", [TQ]),
  ("sql/220 rollback keeps the new clean-up loop", "sql/220_invoicing_rollback.sql", "  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking);", "  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking, 'x', 0);", [TQ]),
  ("sql/221: the guide row differs from the guide file", "sql/221_guide_invoicing_open.sql", "Tap **Send next**. That buyer''s message is copied", "Tap **Send next**. The message is copied", [TG]),
  ("the guide file names the table", "docs/support/sfl-guide.md", "- Nothing here changes an order.", "- Nothing here changes an order (invoice_sends).", [TG]),
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
