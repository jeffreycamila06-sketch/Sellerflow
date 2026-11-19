// node docs/design/fm-pickup-options/harness/shoot.cjs [opt | all | sheets] [lang]
// MOCK-UPS of the options (see harness.tsx). The real screen on port 5330, the In transit view,
// iPhone 390 / Android 360 / laptop 1280, in the app's 8 languages. Then one sheet per option and
// device (the 8 languages side by side). Prints sideways overflow and the numbers of every picture.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..");
const OPTS = ["today", "opt1", "opt2", "opt3"].filter((o) => !process.argv[2] || process.argv[2] === "all" || process.argv[2] === "sheets" || process.argv[2] === o);
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"].filter((l) => !process.argv[3] || process.argv[3] === l);
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];

(async () => {
  const b = await chromium.launch();
  let worst = 0;
  const SHEETS_ONLY = process.argv[2] === "sheets";
  for (const opt of SHEETS_ONLY ? [] : OPTS) for (const [dev, w, h] of DEVICES) for (const lang of LANGS) {
    const narrow = w < 700;
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5330/docs/design/fm-pickup-options/harness/index.html?lang=${lang}`, { waitUntil: "networkidle" });
    await p.waitForSelector(narrow ? "[data-testid=pt-cards]" : "[data-testid=pt-tabs]");
    await p.click(narrow ? "[data-testid=pt-card-transit]" : "[data-testid=pt-tab-transit]");
    await p.waitForTimeout(250);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.mouse.move(2, 2);
    const info = await p.evaluate((o) => window.__decorate(o), opt);
    await p.waitForTimeout(100);
    // a chip or a line cut off inside its row?
    const cut = await p.evaluate(() => [...document.querySelectorAll("[data-mock]")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis").length);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    worst = Math.max(worst, over);
    const file = `${opt}_${dev}_${lang}.png`;
    console.log(`${file}: sideways ${over}px · rows ${info.rows} · flagged ${info.flagged} · In transit shows ${info.transit} · cut ${cut}`);
    // phone: from the count cards down (the part that changes); laptop: the window
    if (narrow) {
      const top = await p.evaluate(() => Math.max(0, document.querySelector("[data-testid=pt-cards]").getBoundingClientRect().top + window.scrollY - 12));
      const full = await p.evaluate(() => document.documentElement.scrollHeight);
      await p.screenshot({ path: path.join(OUT, "shots", file), fullPage: true, clip: { x: 0, y: top, width: w, height: Math.min(full - top, 760) } });
    } else {
      const box = await p.evaluate(() => {
        const top = document.querySelector("[data-testid=pt-search-wrap]").getBoundingClientRect().top + window.scrollY - 14;
        const rows = [...document.querySelectorAll("[data-testid=pt-row]")];
        const bottom = rows[rows.length - 1].getBoundingClientRect().bottom + window.scrollY + 26;
        return { top, height: bottom - top };
      });
      await p.screenshot({ path: path.join(OUT, "shots", file), fullPage: true, clip: { x: 0, y: box.top, width: w, height: box.height } });
    }
    await p.close();
  }
  // sheets: one per option and device, the 8 languages together
  if (!process.argv[3]) for (const opt of OPTS) for (const [dev, w] of DEVICES) {
    const narrow = w < 700;
    const cells = LANGS.map((l) => `<figure><figcaption>${l}</figcaption><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, "shots", `${opt}_${dev}_${l}.png`)).toString("base64")}"></figure>`).join("");
    const html = `<html><body style="margin:0;padding:14px;background:#e9e9f1;font-family:sans-serif"><h2 style="margin:0 0 10px;font-size:20px">${opt} · ${dev}</h2>
      <div style="display:grid;grid-template-columns:repeat(${narrow ? 4 : 2},1fr);gap:12px">${cells}</div>
      <style>figure{margin:0;background:#fff;border:1px solid #c9c9d6;border-radius:8px;overflow:hidden}figcaption{padding:5px 9px;font-weight:700;font-size:14px;background:#4f46e5;color:#fff}img{width:100%;display:block}</style></body></html>`;
    const sheet = await b.newPage({ viewport: { width: narrow ? 4 * w + 90 : 2 * w + 60, height: 900 }, deviceScaleFactor: 1 });
    await sheet.setContent(html, { waitUntil: "load" });
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: path.join(OUT, `sheet_${opt}_${dev}.png`), fullPage: true });
    await sheet.close();
  }
  console.log(`worst sideways overflow: ${worst}px`);
  await b.close();
})();
