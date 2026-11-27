// The REAL app (preview mode, made-up data, ?ptl=1&admin=1) for Admin → Printer testers → Printer list (sql/229):
//   iPhone app 390 (?apk=1&ios=1), Android app 360 (?apk=1), laptop 1280 — light + dark.
//   Shots: the list (note, Built-in · 5, Locked — working), the Testing row with the Lock question open,
//   and the Approve form showing "This name is too close to a locked printer".
// Measured at 360 / 390 / 430 / 1280: nothing wider than the screen; buttons ≥ 44 px tall.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/printer-list-lock/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (p, ms = 350) => p.waitForTimeout(ms);

async function open(b, { w, h, theme = "light", qs = "" }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/admin/tiktok-cooldown/status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{\"success\":false}" }));
  await p.addInitScript((th) => { try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* nothing */ } }, theme);
  await p.goto(`http://localhost:${port}/?admin=1&ptl=1${qs}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 20 && !(await p.locator("[data-testid=admin-ctrl-printertesters]").count()); i++) {
    await p.evaluate(() => [...document.querySelectorAll("button")].filter((x) => /^Admin$/.test((x.textContent || "").trim())).pop()?.click());
    await wait(p, 500);
  }
  await p.evaluate(() => document.querySelector("[data-testid=admin-ctrl-printertesters]").click());
  await p.waitForSelector("[data-testid=pt-panel]");
  await p.evaluate(() => document.querySelector("[data-testid=pt-tab-approved]").click());
  await p.waitForSelector("[data-testid=pt-locked]");
  await wait(p, 500);
  return { p, errs, ctx };
}
const measure = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const panel = document.querySelector("[data-testid=pt-panel]");
  const over = [...panel.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > vw + 0.5).length;
  const btns = [...panel.querySelectorAll("button")].filter((b) => b.offsetParent && !b.closest("[data-testid=pt-panel] > div:first-child"));
  const small = btns.filter((b) => b.getBoundingClientRect().height < 36).map((b) => b.getAttribute("data-testid") || b.textContent);
  const lockBtn = document.querySelector("[data-testid=pt-lock]");
  return { pageWide: document.documentElement.scrollWidth > vw + 1, over, small, lockH: lockBtn ? Math.round(lockBtn.getBoundingClientRect().height) : null,
    locked: panel.querySelectorAll("[data-testid=pt-locked]").length, lockedControls: panel.querySelectorAll("[data-testid=pt-locked] input, [data-testid=pt-locked] button").length,
    builtin: [...panel.querySelectorAll("[data-testid=pt-builtin]")].map((e) => e.textContent).join(" | ") };
});
const scrollTo = (p, sel) => p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "start" }), sel);

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, w, h, qs] of [["iphone390", 390, 844, "&apk=1&ios=1"], ["android360", 360, 800, "&apk=1"], ["phone430", 430, 932, "&apk=1"], ["laptop1280", 1280, 860, ""]]) {
    for (const theme of ["light", "dark"]) {
      const { p, errs, ctx } = await open(b, { w, h, theme, qs });
      await scrollTo(p, "[data-testid=pt-list-note]"); await wait(p);
      await p.screenshot({ path: path.join(OUT, `list_${name}_${theme}.png`) });
      await scrollTo(p, "[data-testid=pt-grp-testing]");
      await p.evaluate(() => document.querySelector("[data-testid=pt-lock]").click()); await wait(p);
      await p.screenshot({ path: path.join(OUT, `testing_lock_${name}_${theme}.png`) });
      const m = await measure(p);
      await p.evaluate(() => document.querySelector("[data-testid=pt-tab-reports]").click());
      await p.waitForSelector("[data-testid=pt-approve]");
      await p.evaluate(() => document.querySelector("[data-testid=pt-approve]").click()); await wait(p, 200);
      await p.evaluate(() => document.querySelector("[data-testid=pt-approve-save]").click());
      await p.waitForSelector("[data-testid=pt-approve-overlap]");
      await scrollTo(p, "[data-testid=pt-approve-form]"); await wait(p);
      await p.screenshot({ path: path.join(OUT, `approve_overlap_${name}_${theme}.png`) });
      lines.push(`${name} ${theme}: pageWide=${m.pageWide} overflowing=${m.over} smallButtons=[${m.small}] lockBtnH=${m.lockH} lockedRows=${m.locked} controlsInLockedRows=${m.lockedControls} errors=${errs.length}`);
      if (theme === "light") lines.push(`  built-in chips: ${m.builtin}`);
      await ctx.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
