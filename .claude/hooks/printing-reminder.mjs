#!/usr/bin/env node
// Claude Code PostToolUse hook (registered in .claude/settings.json). Runs after Edit/Write/MultiEdit.
// Not AI, costs no tokens: if the edited file is a PRINTING file, it injects a reminder into Claude Code's
// context to follow the printing rule; for any other file it prints nothing.
import { isPrintingFile, PRINTING_MAP } from "../../scripts/printing-paths.mjs";
import path from "node:path";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const ev = JSON.parse(raw || "{}");
    const abs = ev?.tool_input?.file_path || ev?.tool_input?.path || "";
    const root = ev?.cwd || process.cwd();
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!isPrintingFile(rel)) return; // not printing → silent, zero cost
    const msg = `PRINTING FILE CHANGED: ${rel}. Printing rule (CLAUDE.md top): read ${PRINTING_MAP}, run the printer-guardian agent and include its parity table in your report, produce TODAY-vs-NEW pictures for every affected print path/size (incl. laptop/web P9, AIMO TEXT P2/P7, Niimbot P6, slip P8, preview), and update ${PRINTING_MAP} in this same branch (CI blocks the branch otherwise).`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }));
  } catch { /* never break Claude Code */ }
});
