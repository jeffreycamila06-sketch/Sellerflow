// node docs/design/pc711-evidence/harness/shoot.cjs — 360 / 390 / 430 px (+ laptop), the first row opened.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  for (const [w, lang] of [[360, "en"], [390, "en"], [430, "en"], [360, "fil"], [360, "th"], [1280, "en"]]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/pc711-evidence/harness/index.html?lang=${lang}`, { waitUntil: "networkidle" });
    await p.locator("[data-testid=pc711-ev-row]").first().click();
    await p.waitForSelector("[data-testid=pc711-ev-detail]");
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${w}px ${lang}: horizontal overflow ${over}px`);
    await p.screenshot({ path: path.join(OUT, `evidence_${w}_${lang}.png`), fullPage: true });
    await p.close();
  }
  await b.close();
})();
