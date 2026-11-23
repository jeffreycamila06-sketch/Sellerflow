// Free orders per live account (sql/208) — pictures of the REAL app (preview mode: src/dev/fakeSupabase.ts with
// ?fac=1; every name is made up): the refused save (Android / web wording and the iPhone wording) and the
// Admin list "Free sharing".
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/free-account-cap/shoot.cjs [port]
// Also writes shots/measure.txt: sideways scroll and the height of the tap targets, per picture.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
const DEVICES = [["360", 360, 780], ["390", 390, 844], ["430", 430, 932], ["1280", 1280, 800]];
const VIEWS = { refused_save: "?fac=1", refused_save_iphone: "?fac=1&ios=1", admin_list: "?fac=1&admin=1", admin_reset_ask: "?fac=1&admin=1" };

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [view, query] of Object.entries(VIEWS)) for (const [dev, w, h] of DEVICES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem("sfl_rd_lang", "en"); localStorage.setItem("sfl_rd_theme", "light"); } catch { /* preview */ } });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`http://localhost:${port}/${query}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    let note = "";
    if (view.startsWith("refused_save")) {
      await p.click("[data-testid=lpk-tile-tt]");
      await p.waitForTimeout(1800);
      await p.getByText("Manage / add accounts").first().click();
      await p.waitForTimeout(700);
      await p.locator("input[placeholder=yourusername]:not([disabled])").first().fill("usedshop");
      await p.getByText("Save profile").click();
      await p.waitForTimeout(900);
      const line = view.endsWith("iphone") ? "This account can't be added right now. Contact support to continue." : "This account's free orders are used — upgrade to continue.";
      const el = p.getByText(line);
      note = `line shown=${(await el.count()) === 1} · Save button ${Math.round((await p.getByText("Save profile").boundingBox()).height)}px`;
      await el.scrollIntoViewIfNeeded();
    } else {
      // phones: Settings → Admin tile; laptop: the Admin button of the side bar
      if (w < 900) {
        await p.locator("button", { hasText: /^Settings$/ }).last().click();
        await p.waitForTimeout(500);
        await p.locator("button", { hasText: /^Admin$/ }).first().click();
      } else await p.locator("button.sfl-nav-admin").click();
      await p.waitForTimeout(600);
      await p.locator("[data-testid=admin-ctrl-freeshare]").scrollIntoViewIfNeeded();
      await p.click("[data-testid=admin-ctrl-freeshare]");
      await p.waitForSelector("[data-testid=fs-panel]");
      await p.waitForTimeout(500);
      if (view === "admin_reset_ask") { await p.locator("[data-testid=fs-reset]").first().click(); await p.waitForTimeout(300); }
      const hs = await p.$$eval("[data-testid=fs-reset], [data-testid=fs-confirm-yes]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      note = `accounts=${await p.locator("[data-testid=fs-account]").count()} devices=${await p.locator("[data-testid=fs-device]").count()} · button heights ${[...new Set(hs)].join("/")}px`;
    }
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const name = `${view}_${dev}.png`;
    await p.screenshot({ path: path.join(OUT, name) });
    lines.push(`${name}: sideways scroll=${sideways} · ${note}${errs.length ? ` · PAGE ERRORS: ${errs.join(" | ").slice(0, 200)}` : ""}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "measure.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
