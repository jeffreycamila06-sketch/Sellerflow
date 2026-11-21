# Shopee Live — other viewers' comments (content type 100), Nov 21 2026

**Evidence (production [SHOPEE-DIAG], seller's test live, PH, Nov 21 09:17–09:22):** the seller's own 2 comments =
content type 101 → kept. Another account commented exactly 2 times → 2 messages `from_others`, both json content,
type 100, both `dropped_notext`. `msgs_e2e=0`, `msgs_system=0`, no repeats.
The reader (`commentTextOf`, server/shopeeLiveLink.js) read type 101 only.

## STEP 0 — is the type-100 shape known?
**No, not for sure.** Searched: branch `claude/shopee-probe` (`scripts/probes/shopee/FINDINGS.md`, `poll.mjs`), every
commit of every branch (`git log --all -S'"type":100'`, `-S'type 100'`, `content_v2`). Only type 101 was ever seen —
the research run tested the HOST's comments only, never a second viewer:
`content = {"type":101,"content":"<comment text>","content_v2":…}`. No sample of a type-100 message exists.
What the live diagnostic does tell us: its content is a JSON object, the type sits in that JSON (a message-level `type`
would have shown in `keys_unknown`), the sender has a uid that is not the host's.

## The change (server only)
- `commentTextOf`: type **100** is read the same way as 101 (the string `content`, else the string `text`), but only
  when the message has a **sender uid** and a text that is **not empty / spaces only**. Any other type-100 message
  (a notice) stays dropped. Type 101 and every other type: exactly as before (tested against main's function).
- Everything after it is the type-101 path, unchanged: the payload (`shopeeToPayload` — handle from username /
  nickname / display_name, name, msgId, time, avatar), the dedupe by msgId, the cursor, the timing → buyer numbers,
  orders and printing in the app treat a viewer's comment exactly like the host's (the app cannot tell them apart).
- If the real type-100 text is NOT in `content` / `text` (for example only in `content_v2`), the comments are still
  dropped — the new diagnostic fields below show the real field names at the first such message.

## The diagnostic (log only, server/shopeeDiag.js)
Two fields at the end of every `[SHOPEE-DIAG]` line: `kept_100=<n>` (kept type-100 messages) and
`keys_100=<paths>` — the field PATHS inside the content JSON of each distinct type-100 shape seen (kept or dropped),
names only, shapes split by `|`, e.g. `keys_100=type,content,content_v2`. Nested objects as `a.b`, arrays as `list[]`
(+ the names of the first object in it). A string is never parsed (a comment typed as JSON must not put its words in
the log). Names cleaned like `keys_unknown` (≤ 24 characters, no 4+ digit run, a map of > 12 names = `many:<n>`);
≤ 24 paths per shape, ≤ 4 shapes (then `|+<n>`). A new type-100 shape writes a line at once, with its own budget
(the other shape lines are capped at 10). The old counters are unchanged (tested against main's diagnostic).

## Read after the deploy (a test live with a second account)
- `kept_100` grows with the viewer's comments and they show in the app → fixed.
- `kept_100=0`, `dropped_notext` grows, `keys_100` shows the text in another field (e.g. only `content_v2`, or
  `content.text`) → one more small change to read that field.

## Proof
- `src/redesign/adapters/__tests__/shopeeViewerComments.server.test.ts` (15 tests): the guard; type 100 = the very
  payload of a 101 with the same fields; a generated corpus (2,047 messages, 10 runs) where the branch reader = main's
  reader with every guard-passing type-100 message rewritten to 101 (same comments, statuses, requests, answers, other
  log lines); with no type-100 message the branch = main; the diagnostic's new fields, privacy, and the old counters
  = main's (`fixtures/shopeeDiag.main.js` = main c398f565's diagnostic, frozen).
- `shopeeDiag.server.test.ts` D4 (reader with the diagnostic = main 5177fd13's reader) still passes unchanged.
- `proof/breaks.py` → `proof/breaks.txt`: 18 on-purpose breaks, each caught.

## Known
- If Shopee sends a type-100 notice WITH a uid and a text (a "joined" line, say), it would show as a comment. In the
  test live the viewer's 2 comments were the only type-100 messages from that account (no join / like came as 100).
- Needs a **Render deploy** (server.js / server/** — manual, or the nightly deploy window). No SQL, no app change.
