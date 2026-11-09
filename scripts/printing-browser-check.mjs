// Real-browser one-label check (e2e/printing/onelabel.ts): starts Vite, opens the page in Playwright Chromium
// (and WebKit when it is installed), and fails when any sticker job is not exactly one label.
// Usage: node scripts/printing-browser-check.mjs [out.json]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require("playwright");
const port = 5199;
const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { stdio: "ignore" });
const url = `http://localhost:${port}/e2e/printing/onelabel.html`;
const wait = async () => { for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("vite did not start"); };
let failed = false;
const all = {};
try {
  await wait();
  for (const [name, type] of [["chromium", chromium], ["webkit", webkit]]) {
    let b;
    try { b = await type.launch(); } catch (e) { console.log(`${name}: not installed here — skipped (${String(e).split("\n")[0]})`); continue; }
    const p = await b.newPage();
    p.on("pageerror", (e) => console.log(`${name} pageerror`, e.message));
    await p.goto(url);
    await p.waitForFunction(() => window.__RESULTS, null, { timeout: 1_800_000, polling: 1000 });
    const r = await p.evaluate(() => window.__RESULTS);
    await b.close();
    all[name] = r;
    const bad = r.cases.filter((c) => c.problems.length);
    console.log(`${name} (${r.ua}): ${r.cases.length} cases, ${bad.length} with problems`);
    for (const c of bad.slice(0, 40)) console.log(`  ${c.route} ${c.printer} ${c.size} qr=${c.qr} ${c.key ?? ""}: ${c.problems.join("; ")}`);
    if (bad.length) failed = true;
  }
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(all));
} finally { vite.kill(); }
process.exit(failed ? 1 : 0);
