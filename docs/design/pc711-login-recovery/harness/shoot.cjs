// node docs/design/pc711-login-recovery/harness/shoot.cjs — 360 / 390 / 430 px + a laptop, logged-out scene
// (+ fil / th / zh-TW / dark) and the evidence scene. Prints the horizontal overflow of each page.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const shots = [
    ["out", 360, "en", 0], ["out", 390, "en", 0], ["out", 430, "en", 0], ["out", 1280, "en", 0],
    ["out", 360, "fil", 0], ["out", 360, "th", 0], ["out", 360, "zh-TW", 0], ["out", 390, "en", 1],
    ["evidence", 360, "en", 0], ["evidence", 390, "en", 0], ["evidence", 430, "en", 0], ["evidence", 1280, "en", 0],
  ];
  for (const [scene, w, lang, dark] of shots) {
    const p = await b.newPage({ viewport: { width: w, height: 760 }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/pc711-login-recovery/harness/index.html?scene=${scene}&lang=${lang}&dark=${dark}`, { waitUntil: "networkidle" });
    await p.waitForSelector(scene === "out" ? "[data-testid=pc711-lo-next]" : "[data-testid=pc711-ev-mirror-remembered]");
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const name = `${scene}_${w}_${lang}${dark ? "_dark" : ""}.png`;
    console.log(`${name}: horizontal overflow ${over}px`);
    await p.screenshot({ path: path.join(OUT, name), fullPage: true });
    await p.close();
  }
  await b.close();
})();
