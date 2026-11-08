// Admin language test screenshots: 360 / 390 / 412 / 430 / 1280, light + dark; states: no chip, 日本語 picked,
// Today's sticker + 한국어; checks: no sideways scroll, every chip/toggle ≥ 44 px, chips inside the card.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const base = "http://localhost:5181/proof-harness-tmp/os.html";
(async () => {
  const b = await chromium.launch();
  const report = [];
  let bad = 0;
  for (const w of [360, 390, 412, 430, 1280]) for (const theme of ["light", "dark"]) for (const state of ["chips", "ja", "today-ko"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w >= 1000 ? 900 : 844 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(`${base}?admin=1&size=60x40&theme=${theme}`);
    await p.waitForSelector('[data-testid="os-preview"][data-ready="1"]', { timeout: 30000 });
    if (state === "ja") await p.click('[data-testid="os-admin-lang-ja"]');
    if (state === "today-ko") { await p.click('[data-testid="os-admin-route-today"]'); await p.click('[data-testid="os-admin-lang-ko"]'); }
    if (state !== "chips") { await p.waitForTimeout(400); await p.waitForLoadState("networkidle"); await p.waitForTimeout(1500); }
    const r = await p.evaluate(() => {
      const issues = [];
      const card = document.querySelector('[data-testid="os-admin-lang"]').getBoundingClientRect();
      for (const el of document.querySelectorAll('[data-testid="os-admin-lang"] button')) {
        const x = el.getBoundingClientRect();
        if (x.height < 43.5) issues.push(`${el.textContent} ${x.height.toFixed(0)}px tall`);
        if (x.right > card.right + 0.5 || x.left < card.left - 0.5) issues.push(`${el.textContent} outside the card`);
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) issues.push("sideways scroll");
      return issues;
    });
    bad += r.length;
    report.push(`${w} ${theme} ${state}: ${r.length ? r.join("; ") : "ok"}`);
    const el = await p.$('[data-testid="os-pv-col"]');
    if (w >= 1000) await p.screenshot({ path: path.join(out, `admin-lang_${w}_${theme}_${state}.png`) });
    else await el.screenshot({ path: path.join(out, `admin-lang_${w}_${theme}_${state}.png`) });
    await ctx.close();
  }
  await b.close();
  report.push(`problems: ${bad}`);
  fs.writeFileSync(path.join(out, "check.txt"), report.join("\n") + "\n");
  console.log(report.join("\n"));
})();
