// node docs/design/fm-pickup-accuracy-2/harness/wrap-shoot.cjs <before|after>
// Pictures of the "Not dropped off yet" group (the 4 rows with the right-hand date lines), real screen on
// port 5331, iPhone 390 and Android 360, the app's 8 languages; then one sheet per device.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const tag = process.argv[2] || "after";
const OUT = path.join(__dirname, "..", "wrap");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800]];
(async () => {
  const b = await chromium.launch();
  for (const [dev, w, h] of DEVICES) {
    for (const lang of LANGS) {
      const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await p.goto(`http://localhost:5331/docs/design/fm-pickup-accuracy-2/harness/index.html?lang=${lang}`, { waitUntil: "networkidle" });
      await p.waitForSelector("[data-testid=pt-cards]");
      await p.click("[data-testid=pt-card-transit]");
      await p.waitForSelector("[data-testid=pt-fm-group]");
      await p.waitForTimeout(200);
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      const box = await p.evaluate(() => {
        const head = document.querySelector("[data-testid=pt-fm-group]").getBoundingClientRect();
        const rows = [...document.querySelectorAll("[data-testid=pt-row]")];
        const last = rows[rows.length - 1].getBoundingClientRect();
        return { top: head.top + window.scrollY - 2, height: last.bottom - head.top + 4 };
      });
      await p.screenshot({ path: path.join(OUT, `${tag}_${dev}_${lang}.png`), fullPage: true, clip: { x: 0, y: box.top, width: w, height: box.height } });
      await p.close();
    }
    const cells = LANGS.map((l) => `<figure><figcaption>${l}</figcaption><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, `${tag}_${dev}_${l}.png`)).toString("base64")}"></figure>`).join("");
    const html = `<html><body style="margin:0;padding:14px;background:#e9e9f1;font-family:sans-serif"><h2 style="margin:0 0 10px;font-size:20px">${tag === "before" ? "BEFORE (main of this branch)" : "AFTER (fix round 1)"} · ${dev} · "Not dropped off yet" rows</h2>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start">${cells}</div>
      <style>figure{margin:0;background:#fff;border:1px solid #c9c9d6;border-radius:8px;overflow:hidden}figcaption{padding:5px 9px;font-weight:700;font-size:14px;background:${tag === "before" ? "#9ca3af" : "#4f46e5"};color:#fff}img{width:100%;display:block}</style></body></html>`;
    const sheet = await b.newPage({ viewport: { width: 4 * w + 90, height: 900 }, deviceScaleFactor: 1 });
    await sheet.setContent(html, { waitUntil: "load" });
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: path.join(OUT, `sheet_${tag}_${dev}.png`), fullPage: true });
    await sheet.close();
  }
  await b.close();
  console.log("done", tag);
})();
