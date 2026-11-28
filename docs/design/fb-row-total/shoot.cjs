// Invoicing → Facebook list row totals (preview ?ivc=0,0&fbsa=1&fbedit=1&admin=1). server: npx vite --config vite.preview.config.ts --port 5199
// node docs/design/fb-row-total/shoot.cjs <out dir>
const { chromium } = require("playwright");
const OUT = process.argv[2];
const tap = (p, s) => p.evaluate((x) => document.querySelector(x).click(), s);
const wait = (p, ms = 350) => p.waitForTimeout(ms);
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[390, 844], [1280, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem("sfl_rd_theme", "light"); localStorage.setItem("sfl_rd_lang", "en"); } catch {} window.open = () => null; });
    await p.route("**/fb/access**", (r) => r.fulfill({ json: { ok: true, facebook: true, receipt: true } }));
    await p.route("**/fb/sendall/status**", (r) => r.fulfill({ json: { ok: true, access: true, allowed: true, needsMessaging: false, buyers: [], job: null } }));
    await p.route("**/fb/sendall/preview**", (r) => r.fulfill({ json: { ok: false } }));
    await p.goto(`http://localhost:5199/?ivc=0,0&fbsa=1&fbedit=1&admin=1`, { waitUntil: "networkidle" });
    await wait(p, 900);
    for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
      await p.evaluate((k) => { const live = [...document.querySelectorAll("button")].filter((x) => /^(Live)$/i.test((x.textContent || "").trim()))[0]; const menu = live ? [...live.parentElement.querySelectorAll("button")] : []; menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click(); }, i);
      await wait(p, 400);
    }
    await tap(p, "[data-testid=tile-invoicing]");
    await p.waitForSelector("[data-testid=ivc-tab-facebook]");
    await tap(p, "[data-testid=ivc-tab-facebook]");
    await p.waitForSelector("[data-testid=ivc-fb-list]"); await wait(p, 600);
    await p.evaluate(() => document.querySelector("[data-testid=ivc-fb-filters]").scrollIntoView({ block: "start" }));
    await wait(p, 200);
    const rows = await p.$$eval("[data-testid=ivc-fb-row]", (rs) => rs.map((r) => r.getAttribute("data-buyer") + "=" + r.querySelector("[data-testid=ivc-fb-row-total]").textContent + (r.querySelector("[data-testid=ivc-fb-row-edited]") ? "(edited)" : "")));
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(w, rows.join(" "), "wide=" + wide);
    await p.screenshot({ path: `${OUT}/list-${w}.png` });
    await ctx.close();
  }
  await b.close();
})();
