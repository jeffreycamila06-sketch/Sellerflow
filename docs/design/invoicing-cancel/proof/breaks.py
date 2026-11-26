# On-purpose breaks: each one changes the real code a little, runs the new tests, then puts the file back.
# A break is "caught" when at least one test fails. Run from the repo root:
#   python3 docs/design/invoicing-cancel/proof/breaks.py
import subprocess, sys
AD = "src/redesign/adapters/invoicing.ts"; INV = "src/redesign/screens/Invoicing.tsx"; SH = "src/redesign/components/TikTokSendSheet.tsx"; APP = "src/redesign/RedesignApp.tsx"
TESTS = ["src/redesign/screens/__tests__/Invoicing.cancel.test.tsx", "src/redesign/adapters/__tests__/invoicingCancelSql.test.ts"]
BREAKS = [
  ("a cancelled buyer reads as Not sent (Send next takes them)", AD, '  if (saved.status === "cancelled") return "cancelled";\n', ""),
  ("N keeps counting the cancelled buyer", AD, "const active = rows.length - cancelled;", "const active = rows.length;"),
  ("a cancelled buyer is listed under Not sent", AD, 'state !== "sent" && state !== "cancelled");', 'state !== "sent");'),
  ("Undo cancel always goes back to Not sent", INV, 'if (prev?.status === "cancelled" && prev.sentAt) status.mark(r, "sent", prev.hash);', 'if (false) status.mark(r, "sent", prev?.hash);'),
  ("Undo cancel always goes back to Sent", INV, "    else status.clear(r);\n", "    else status.mark(r, \"sent\");\n"),
  ("the Blacklist question shows for a seller without Blacklist", INV, "if (onBlacklistAdd) setBlAsk(", "if (true) setBlAsk("),
  ("Yes does not add to Blacklist", INV, "void onBlacklistAdd(handle).then(", "void Promise.resolve({ kind: \"added\" } as BlAddResult).then("),
  ("RedesignApp passes the add without the Blacklist gate", APP, '{...(blacklistOn ? { onBlacklistAdd:', '{...(true ? { onBlacklistAdd:'),
  ("a cancelled line stays in the row's lines / total", AD, "const lines = initialSendLines(receipt.lines).filter((_, j) => !cancelled[j]);", "const lines = initialSendLines(receipt.lines);"),
  ("a cancelled line stays in the sheet's message", SH, "const kept = lines.filter((l) => !isCut(l));", "const kept = lines;"),
  ("cancelled lines matched by position, not by order id", AD, "const cancelled = orderIds.map((oid) => oid !== null && !!extra.cancelled?.has(oid));", "const cancelled = orderIds.map((_oid, j) => !!extra.cancelled?.has(j));"),
  ("× removes the line without saving", SH, "    invoice.onCancelLine(id, true);\n", "    removeLine(l.key);\n"),
  ("Undo of a line is not saved", AD, "    const { error } = await supabase.from(LINE_CANCELS).delete()", "    const { error } = { error: null }; void supabase.from(LINE_CANCELS).delete"),
  ("the last line is cancelled without asking", SH, "if (left <= 1 && invoice.onCancelBuyer)", "if (left <= 0 && invoice.onCancelBuyer)"),
  ("No on 'cancel the whole buyer' cancels the buyer", SH, 'onClick={() => setAskWhole(false)}', 'onClick={() => { setAskWhole(false); invoice.onCancelBuyer?.(); }}'),
  ("a line cancelled after the send makes it 'New item'", AD, "  for (let mask = 1; mask < 1 << off.length; mask++) {", "  for (let mask = 1 << 30; mask < 1 << off.length; mask++) {"),
  ("the saved cancelled lines are not read back", AD, "for (const r of rows) { const n = Number(r.order_id); if (isOrderId(n)) out.add(n); }", "void rows;"),
  ("Send next does not wait for the cancelled lines", INV, ' && cancels.state === "ready";', ";"),
  ("the order ids are read by session even without a real session id", AD, "const sessionId = sessionIdArg && UUID_RE.test(sessionIdArg) ? sessionIdArg : null;", "const sessionId = sessionIdArg;"),
  ("Undo time not given back by sql/222 (stamp rule removed)", "sql/222_invoicing_cancel.sql", "  elsif new.status = 'sent' and tg_op = 'UPDATE' and old.status = 'cancelled' and old.sent_at is not null then\n    new.sent_at := old.sent_at;\n", ""),
]
caught = 0
for name, f, old, new in BREAKS:
    src = open(f).read()
    if old not in src: print(f"SKIP (text not found): {name}"); continue
    open(f, "w").write(src.replace(old, new, 1))
    try:
        r = subprocess.run(["npx", "vitest", "run", *TESTS], capture_output=True, text=True)
    finally:
        open(f, "w").write(src)
    ok = r.returncode != 0
    caught += ok
    print(f"{'caught' if ok else 'MISSED'}: {name}")
print(f"{caught} of {len(BREAKS)} caught")
sys.exit(0 if caught == len(BREAKS) else 1)
