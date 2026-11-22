// Seller Website redesign proposal — pictures of the MOCK (docs/design/website-redesign/after/mock.html).
// Run: (1) npx vite --port 5199 --strictPort   (2) FONT_DIR=<folder with latin.css + .woff2> node docs/design/website-redesign/harness/after.cjs [name-prefix]
// FONT_DIR: the mock's Google Fonts css saved as latin.css + its .woff2 files (the browser here has no internet).
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "after-shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/website-redesign/after/mock.html";
const ONLY = process.argv[2] || "";
const VIEWS = [
  ["iphone390", { ...devices["iPhone 13"], deviceScaleFactor: 2 }],
  ["android412", { ...devices["Pixel 7"], deviceScaleFactor: 2 }],
  ["laptop1280", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 }],
];
const SHOTS = [];
for (const [i, p] of ["home", "product", "cart", "checkout", "order"].entries()) SHOTS.push([`budgetukay-${i + 1}-${p}`, `?shop=budgetukay&page=${p}&bare=1`, VIEWS]);
for (const s of ["sundayoven", "voltline"]) { SHOTS.push([`${s}-1-home`, `?shop=${s}&page=home&bare=1`, [VIEWS[0], VIEWS[2]]]); SHOTS.push([`${s}-2-product`, `?shop=${s}&page=product&bare=1`, [VIEWS[0]]]); }
SHOTS.push(["dewroom-1-home", "?shop=dewroom&page=home&bare=1", [VIEWS[0], VIEWS[2]]]);
(async () => {
  const browser = await chromium.launch();
  const dir = process.env.FONT_DIR;
  const made = [];
  for (const [name, qs, views] of SHOTS) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const [vn, dev] of views) {
      const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
      const page = await ctx.newPage();
      await page.route("**/fonts.googleapis.com/**", (r) => (dir ? r.fulfill({ status: 200, contentType: "text/css", body: fs.readFileSync(path.join(dir, "latin.css"), "utf8") }) : r.abort()));
      await page.route("**/fonts.gstatic.com/**", (r) => { const f = dir && path.join(dir, path.basename(new URL(r.request().url()).pathname)); return f && fs.existsSync(f) ? r.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) }) : r.abort(); });
      const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
      await page.goto(BASE + qs, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
      const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")).filter((v, i, a) => a.indexOf(v) === i).join("+") || "none");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: path.join(OUT, `${name}_${vn}_first.jpg`), type: "jpeg", quality: 80 });
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const vp = page.viewportSize();
      if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 7000) }); await page.waitForTimeout(250); }
      await page.screenshot({ path: path.join(OUT, `${name}_${vn}_full.jpg`), type: "jpeg", quality: 78 });
      made.push(`${name}_${vn} h=${h} fonts=${fonts} sideways=${over}${errs.length ? " ERR " + errs[0] : ""}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(made.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
