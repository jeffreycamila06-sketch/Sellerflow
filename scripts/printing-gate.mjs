// CI gate: if a branch/PR changes any PRINTING file but does not update docs/printing/PRINTING_MAP.md,
// fail with a plain message. Deterministic (no AI). Usage: node scripts/printing-gate.mjs [baseRef]
import { execSync } from "node:child_process";
import { isPrintingFile, PRINTING_MAP } from "./printing-paths.mjs";
const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
let base = process.argv[2] || process.env.PRINTING_GATE_BASE || "";
try {
  if (!base) {
    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || sh("git rev-parse --abbrev-ref HEAD");
    base = branch === "main" ? "HEAD^1" : sh("git merge-base origin/main HEAD");
  }
} catch { console.log("printing-gate: no base found — skipped"); process.exit(0); }
let files = [];
try { files = sh(`git diff --name-only ${base} HEAD`).split("\n").filter(Boolean); }
catch { console.log("printing-gate: diff failed — skipped"); process.exit(0); }
const printing = files.filter(isPrintingFile);
if (!printing.length) { console.log("printing-gate: no printing files changed — OK"); process.exit(0); }
if (files.includes(PRINTING_MAP)) { console.log(`printing-gate: ${printing.length} printing file(s) changed and ${PRINTING_MAP} updated — OK`); process.exit(0); }
console.error(`\n❌ PRINTING GATE: these printing files changed but ${PRINTING_MAP} was NOT updated:\n  - ${printing.join("\n  - ")}\n\nRun the printer-guardian agent, fill the parity row for EVERY print path (incl. laptop/web, AIMO TEXT, Niimbot, slip, preview), add pictures, and update ${PRINTING_MAP} in this branch.\n`);
process.exit(1);
