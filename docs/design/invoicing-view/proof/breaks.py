# On-purpose breaks: each one changes the real code a little, runs the new tests, then puts the file back.
# A break is "caught" when at least one test fails. Run from the repo root: python3 docs/design/invoicing-view/proof/breaks.py
import subprocess, sys
INV = "src/redesign/screens/Invoicing.tsx"; AD = "src/redesign/adapters/invoicing.ts"; SH = "src/redesign/components/TikTokSendSheet.tsx"
BREAKS = [
  ("count adds up quantities instead of lines", AD, "r.receipt.lines.length", "r.receipt.lines.reduce((s, l) => s + (l.qty || 1), 0)"),
  ("count off by one", AD, "r.receipt.lines.length", "r.receipt.lines.length + 1"),
  ("'1 items' instead of '1 item'", INV, "n === 1 ? t.rd_ivc_items_1 : ", ""),
  ("count line not shown", INV, "· {itemsText(itemCount(r))}", ""),
  ("View opens the first row, not its own", INV, "e.stopPropagation(); setSheetId(r.id);", "e.stopPropagation(); setSheetId(shown[0].id);"),
  ("View opens nothing", INV, "e.stopPropagation(); setSheetId(r.id);", "e.stopPropagation();"),
  ("row tap no longer opens the sheet", INV, 'data-tag={tag} onClick={() => setSheetId(r.id)}', "data-tag={tag}"),
  ("View loses its 44px tap area", INV, 'className="sfl-tap44"', ""),
  ("View without the accent outline", INV, 'border: "1.5px solid var(--accent)", background: "transparent", color: "var(--accent-fg)", fontSize: 12', 'border: "none", background: "transparent", color: "var(--accent-fg)", fontSize: 12'),
  ("by hand also for Next", AD, 'tag === "copy_failed" || tag === "sending"', 'tag === "copy_failed" || tag === "sending" || tag === "next"'),
  ("by hand also for Sent", AD, 'tag === "copy_failed" || tag === "sending"', 'tag === "copy_failed" || tag === "sending" || tag === "sent"'),
  ("by hand only for Sending", AD, 'tag === "copy_failed" || tag === "sending"', 'tag === "sending"'),
  ("by hand saves Can't message", INV, 'status.mark(sheetRow, "sent");\n                if (pendingId', 'status.mark(sheetRow, "skipped");\n                if (pendingId'),
  ("by hand saves nothing", INV, 'status.mark(sheetRow, "sent");\n                if (pendingId', 'if (pendingId'),
  ("by hand leaves the sheet open", INV, 'via: "hand" });\n                setSheetId(null);', 'via: "hand" });'),
  ("by hand leaves 'Copy failed' on the row", INV, 'if (copyFailedId === sheetRow.id) setCopyFailed(activeKey, null);\n                track("invoice_send", { platform: "tiktok", via: "hand" })', 'track("invoice_send", { platform: "tiktok", via: "hand" })'),
  ("sheet ignores the by-hand rule (always shown in Invoicing)", SH, "{invoice.onSentByHand && (", "{(invoice.onSentByHand || true) && ("),
  ("by hand shown in the Orders sheet too", SH, '            </button>\n          )}\n          </>) : (<>', '            </button>\n          )}\n          </>) : (<>\n          <button type="button" data-testid="tts-by-hand">x</button>'),
]
caught = 0
for name, f, old, new in BREAKS:
    src = open(f).read()
    if old not in src: print(f"SKIP (text not found): {name}"); continue
    open(f, "w").write(src.replace(old, new, 1))
    try:
        r = subprocess.run(["npx", "vitest", "run", "src/redesign/screens/__tests__/Invoicing.view.test.tsx"], capture_output=True, text=True)
    finally:
        open(f, "w").write(src)
    ok = r.returncode != 0
    caught += ok
    print(f"{'caught' if ok else 'MISSED'}: {name}")
print(f"{caught} of {len(BREAKS)} caught")
sys.exit(0 if caught == len(BREAKS) else 1)
