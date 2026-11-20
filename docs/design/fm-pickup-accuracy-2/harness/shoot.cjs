// node docs/design/fm-pickup-accuracy-2/harness/shoot.cjs [lang]
// The REAL Pickup Status screen (harness on port 5331), the In transit view, iPhone 390 / Android 360 /
// laptop 1280, in the app's 8 languages; then one sheet per device with the 8 languages side by side.
// Prints sideways overflow, the In transit number, the group number, and any label that is cut off.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"].filter((l) => !process.argv[2] || process.argv[2] === l);
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];

(async () => {
  const b = await chromium.launch();
  let worst = 0, cutAll = 0;
  for (const [dev, w, h] of DEVICES) for (const lang of LANGS) {
    const narrow = w < 700;
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5331/docs/design/fm-pickup-accuracy-2/harness/index.html?lang=${lang}`, { waitUntil: "networkidle" });
    await p.waitForSelector(narrow ? "[data-testid=pt-cards]" : "[data-testid=pt-tabs]");
    await p.click(narrow ? "[data-testid=pt-card-transit]" : "[data-testid=pt-tab-transit]");
    await p.waitForSelector("[data-testid=pt-fm-group]");
    await p.waitForTimeout(200);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.mouse.move(2, 2);
    const info = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const isCut = (e) => e && e.scrollWidth > e.clientWidth + 1;
      const labels = [...document.querySelectorAll("[data-testid=pt-card-held], [data-testid=pt-fm-group] div, [data-testid=pt-no-record], [data-testid=pt-not-dropped], [data-testid=pt-left]")];
      const cut = labels.filter(isCut).map((e) => `${e.getAttribute("data-testid") || "group"}:"${e.textContent}"`);
      // a chip pushed past the right edge of its row
      const rowsOver = [...document.querySelectorAll("[data-testid=pt-row]")].filter((r) => r.scrollWidth > r.clientWidth + 1).length;
      return {
        rows: document.querySelectorAll("[data-testid=pt-row]").length,
        transit: (q("[data-testid=pt-card-transit]")?.firstElementChild?.textContent) ?? q("[data-testid=pt-tab-transit] span")?.textContent ?? null,
        held: q("[data-testid=pt-fm-group-n]")?.textContent ?? null,
        cardLine: q("[data-testid=pt-card-held]")?.textContent ?? null,
        cut, rowsOver,
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    worst = Math.max(worst, info.sideways);
    cutAll += info.cut.length + info.rowsOver;
    const file = `${dev}_${lang}.png`;
    console.log(`${file}: sideways ${info.sideways}px · rows ${info.rows} · In transit ${info.transit} · group ${info.held}${info.cardLine ? ` · card "${info.cardLine}"` : ""} · cut ${info.cut.length ? info.cut.join(", ") : 0} · rows wider than the screen ${info.rowsOver}`);
    if (narrow) {
      const top = await p.evaluate(() => Math.max(0, document.querySelector("[data-testid=pt-cards]").getBoundingClientRect().top + window.scrollY - 12));
      const bottom = await p.evaluate(() => { const rows = [...document.querySelectorAll("[data-testid=pt-row]")]; return rows[rows.length - 1].getBoundingClientRect().bottom + window.scrollY + 14; });
      await p.screenshot({ path: path.join(OUT, "shots", file), fullPage: true, clip: { x: 0, y: top, width: w, height: bottom - top } });
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
  if (!process.argv[2]) for (const [dev, w] of DEVICES) {
    const narrow = w < 700;
    const cells = LANGS.map((l) => `<figure><figcaption>${l}</figcaption><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, "shots", `${dev}_${l}.png`)).toString("base64")}"></figure>`).join("");
    const html = `<html><body style="margin:0;padding:14px;background:#e9e9f1;font-family:sans-serif"><h2 style="margin:0 0 10px;font-size:20px">Pickup Status · In transit · ${dev}</h2>
      <div style="display:grid;grid-template-columns:repeat(${narrow ? 4 : 2},1fr);gap:12px;align-items:start">${cells}</div>
      <style>figure{margin:0;background:#fff;border:1px solid #c9c9d6;border-radius:8px;overflow:hidden}figcaption{padding:5px 9px;font-weight:700;font-size:14px;background:#4f46e5;color:#fff}img{width:100%;display:block}</style></body></html>`;
    const sheet = await b.newPage({ viewport: { width: narrow ? 4 * w + 90 : 2 * w + 60, height: 900 }, deviceScaleFactor: 1 });
    await sheet.setContent(html, { waitUntil: "load" });
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: path.join(OUT, `sheet_${dev}.png`), fullPage: true });
    await sheet.close();
  }
  console.log(`worst sideways overflow: ${worst}px · labels cut off: ${cutAll}`);
  await b.close();
})();
