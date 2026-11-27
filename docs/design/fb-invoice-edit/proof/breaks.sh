#!/bin/bash
cd /home/user/Sellerflow
[ -z "$(git status --short)" ] || { echo "tree not clean — stop"; exit 1; }
T=src/redesign/adapters/__tests__; V=src/redesign/screens/__tests__
run() { name="$1"; f="$2"; old="$3"; new="$4"; shift 4
  python3 -c "import sys;p,o,n=sys.argv[1:4];s=open(p).read();assert o in s;open(p,'w').write(s.replace(o,n,1))" "$f" "$old" "$new" || { echo "SETUP FAIL $name"; return; }
  out=$(timeout 300 npx vitest run "$@" 2>&1 | grep -E "Tests "); git checkout -q -- "$f"
  case "$out" in *failed*) echo "RED   | $name |$out";; *) echo "GREEN!| $name |$out";; esac; }
run "server ignores the saved edit" server/fbSendAll.js '() => picture(kept, settings, job.lang, job.currency, edit), preflight);' '() => picture(kept, settings, job.lang, job.currency), preflight);' $T/fbSendAllEdit.server.test.ts
run "preview ignores the saved edit" server/fbSendAll.js 'const png = await picture(kept, settings, b.lang, b.currency, edit);' 'const png = await picture(kept, settings, b.lang, b.currency);' $T/fbSendAllEdit.server.test.ts
run "edits read error = no edits (sends the orders)" server/fbSendAll.js 'const readEdits = async (uid, sid) => (typeof store.listReceiptEdits === "function" ? store.listReceiptEdits(uid, sid) : []);' 'const readEdits = async (uid, sid) => (typeof store.listReceiptEdits === "function" ? store.listReceiptEdits(uid, sid).catch(() => []) : []);' $T/fbSendAllEdit.server.test.ts
run "edit with no line still sent" server/fbSendAll.js 'const editEmpty = (edit) => !!edit && editPictureLines(edit.lines).length === 0;' 'const editEmpty = () => false;' $T/fbSendAllEdit.server.test.ts
run "server keeps emoji in the edit" src/lib/receiptEdit.js '    opening: noEmoji(e.opening),' '    opening: e.opening,' $T/fbSendAllEdit.server.test.ts
run "phone input not the server's (name)" src/redesign/adapters/fbReceiptEditState.ts 'buyerName: noEmoji(ctx.receipt.name) || noEmoji(ctx.receipt.handle),' 'buyerName: ctx.receipt.name,' $T/fbSendAllEdit.server.test.ts
run "Send without saving first" src/redesign/components/FbSendAllTab.tsx 'const send = async () => { if (await saveNow()) onSend(); };' 'const send = async () => { onSend(); void saveNow(); };' $V/Invoicing.fbEdit.test.tsx
run "back to the orders keeps the row" src/redesign/components/FbSendAllTab.tsx 'const same = sameEdit(state, original);' 'const same = false;' $V/Invoicing.fbEdit.test.tsx
run "Reset without asking" src/redesign/components/FbSendAllTab.tsx 'onClick={() => setAskReset(true)}' 'onClick={() => void doReset()}' $V/Invoicing.fbEdit.test.tsx
run "editor starts with cancelled lines" src/redesign/adapters/fbReceiptEditState.ts 'lines: receipt.lines.flatMap((l, i) => (cancelled[i] ? [] : [{ id: i, item: l.item, price: String(l.total) }])),' 'lines: receipt.lines.map((l, i) => ({ id: i, item: l.item, price: String(l.total) })),' $T/fbSendAllEdit.server.test.ts $V/Invoicing.fbEdit.test.tsx
run "no Edited tag on the row" src/redesign/components/FbSendAllTab.tsx 'if (!e) return null;' 'return null;' $V/Invoicing.fbEdit.test.tsx
run "ended session stays on This session" src/redesign/screens/Invoicing.tsx 'const fbNoId = !!fbSendAll' 'const fbNoId = false && !!fbSendAll' $V/Invoicing.endedSession.test.tsx
run "Orders sheet field changed" src/redesign/components/ReceiptEditorFields.tsx '<textarea data-testid="rs-note" value={note} maxLength={1000}' '<textarea data-testid="rs-note" value={note} maxLength={999}' $V/ReceiptSheet.sameAsMain.test.tsx
run "sql/233 anon keeps access" sql/233_fb_receipt_edits.sql 'revoke all on public.fb_receipt_edits from public, anon;' 'revoke all on public.fb_receipt_edits from public;' $T/fbReceiptEditsSql.test.ts
git status --short
