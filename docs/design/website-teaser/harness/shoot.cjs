// Website teaser — the REAL Settings + Sales screens at iPhone / Android / laptop width for:
// a non-tester with both switches on, a non-tester with both switches off, and a tester (unchanged).
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/website-teaser/harness/shoot.cjs
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/website-teaser/harness/index.html";
const VIEWS = [["iphone", devices["iPhone 13"]], ["android", devices["Pixel 7"]], ["laptop", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }]];
const CASES = [["nontester-switches-on", "who=nontester&sw=on"], ["nontester-switches-off", "who=nontester&sw=off"], ["tester", "who=tester&sw=on"]];
(async () => {
  const browser = await chromium.launch();
  let n = 0;
  for (const [name, qs] of CASES) for (const screen of ["settings", "sales"]) for (const [vn, dev] of VIEWS) {
    const ctx = await browser.newContext({ ...dev, locale: "en-US" });
    const page = await ctx.newPage();
    await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
    await page.goto(`${BASE}?${qs}&screen=${screen}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}_${screen}_${vn}.jpg`), type: "jpeg", quality: 80, fullPage: true });
    n++; await ctx.close();
  }
  await browser.close();
  console.log(`${n} screenshots in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
