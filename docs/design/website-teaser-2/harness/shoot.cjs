// Website teaser part 2 — the REAL Settings, Sales and Orders screens at iPhone / Android / laptop width for a
// non-tester (switches on / off) and a tester (unchanged), plus Orders in every language at iPhone width (the
// longest one is reported) and at 360 px.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/website-teaser-2/harness/shoot.cjs
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/website-teaser-2/harness/index.html";
const VIEWS = [["iphone", devices["iPhone 13"]], ["android", devices["Pixel 7"]], ["laptop", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }]];
const CASES = [["nontester-switches-on", "who=nontester&sw=on"], ["nontester-switches-off", "who=nontester&sw=off"], ["tester", "who=tester&sw=on"]];
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const open = async (browser, dev, qs) => {
  const ctx = await browser.newContext({ ...dev, locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/demo.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto(`${BASE}?${qs}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { ctx, page };
};
// the tab row: do the existing tabs keep one line, and does any text spill out of its tab?
const measure = (page) => page.evaluate(() => {
  const ids = ["orders-tab-orders", "orders-tab-miners", "orders-tab-website-soon", "orders-tab-website"];
  const out = {};
  for (const id of ids) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    out[id] = { w: Math.round(r.width), h: Math.round(r.height), oneLine: r.height < lh * 1.9 + 16, clipped: el.scrollWidth > el.clientWidth + 1, text: el.textContent };
  }
  return out;
});
(async () => {
  const browser = await chromium.launch();
  let n = 0;
  const report = [];
  for (const [name, qs] of CASES) for (const screen of ["settings", "sales", "orders"]) for (const [vn, dev] of VIEWS) {
    const { ctx, page } = await open(browser, dev, `${qs}&screen=${screen}`);
    if (screen === "orders") report.push({ case: name, view: vn, lang: "en", tabs: await measure(page) });
    await page.screenshot({ path: path.join(OUT, `${name}_${screen}_${vn}.jpg`), type: "jpeg", quality: 80, fullPage: screen !== "orders" });
    n++; await ctx.close();
  }
  // Orders in every language, non-tester with the switch on, at iPhone (390) and at 360 px
  const phone360 = { ...devices["iPhone 13"], viewport: { width: 360, height: 760 } };
  let longest = null;
  for (const lang of LANGS) for (const [vn, dev] of [["iphone", devices["iPhone 13"]], ["360px", phone360]]) {
    const { ctx, page } = await open(browser, dev, `who=nontester&sw=on&screen=orders&lang=${lang}`);
    const tabs = await measure(page);
    report.push({ case: "nontester-switches-on", view: vn, lang, tabs });
    const len = Object.values(tabs).map((x) => x.text).join("").length;
    if (vn === "iphone" && (!longest || len > longest.len)) longest = { lang, len };
    await page.screenshot({ path: path.join(OUT, `orders-lang-${lang}_${vn}.jpg`), type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: page.viewportSize().width, height: 170 } });
    n++; await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "orders-tabs-measure.json"), JSON.stringify({ longest, report }, null, 1));
  await browser.close();
  console.log(`${n} screenshots; longest language (Orders tab text): ${longest.lang}`);
})().catch((e) => { console.error(e); process.exit(1); });
