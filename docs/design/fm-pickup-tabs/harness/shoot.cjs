// node docs/design/fm-pickup-tabs/harness/shoot.cjs — BEFORE (main, port 5321) vs AFTER (branch, port 5320),
// iPhone 390 / Android 360 / laptop 1280. Start both servers first (see vite.config.mjs; BEFORE = a main
// worktree with this harness copied in). Prints each page's horizontal overflow and the numbers it shows.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const ONLY_ENV = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
const ENVS = [["before", 5321], ["after", 5320]].filter(([e]) => !ONLY_ENV || e === ONLY_ENV);
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];

(async () => {
  const b = await chromium.launch();
  for (const [env, port] of ENVS) for (const [dev, w, h] of DEVICES) {
    const narrow = w < 700;
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:${port}/docs/design/fm-pickup-tabs/harness/index.html`, { waitUntil: "networkidle" });
    await p.waitForSelector(narrow ? "[data-testid=pt-cards]" : "[data-testid=pt-tabs]");
    const numbers = async () => p.evaluate((nw) => {
      const ids = nw ? ["transit", "waiting", "picked", "returned"] : ["all", "transit", "waiting", "picked", "returned"];
      const pre = nw ? "pt-card-" : "pt-tab-";
      const out = ids.map((k) => `${k} ${(document.querySelector(`[data-testid=${pre}${k}]`)?.textContent || "").match(/\d+/)?.[0]}`);
      return `${out.join(" · ")} · rows listed ${document.querySelectorAll("[data-testid=pt-row]").length}`;
    }, narrow);
    const shot = async (name) => {
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = `${name}_${dev}_${env}.png`;
      console.log(`${file}: overflow ${over}px · ${await numbers()}`);
      await p.screenshot({ path: path.join(OUT, file), fullPage: narrow });
    };
    const pick = async (tab) => { await p.click(narrow ? `[data-testid=pt-card-${tab}]` : `[data-testid=pt-tab-${tab}]`); await p.waitForTimeout(250); };
    // 1. as the screen opens: Waiting, every store
    await shot("1-waiting");
    // 2. In transit
    await pick("transit");
    await shot("2-transit");
    // 3. Picked up
    await pick("picked");
    await shot("3-picked");
    // 4. the store filter on FamilyMart, Waiting
    await pick("waiting");
    await p.click("[data-testid=pt-store-btn]");
    await p.click("[data-testid=pt-store-opt-fm]");
    await p.waitForTimeout(250);
    await shot("4-familymart-filter");
    // 5. laptop only: the All tab (where the rows were before)
    if (!narrow) {
      await p.click("[data-testid=pt-store-btn]");
      await p.click("[data-testid=pt-store-opt-all]");
      await pick("all");
      await shot("5-all");
    }
    await p.close();
  }
  await b.close();
})();
