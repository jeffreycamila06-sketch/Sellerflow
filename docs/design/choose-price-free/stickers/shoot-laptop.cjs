// node docs/design/choose-price-free/stickers/shoot-laptop.cjs
// Today's LAPTOP sticker page (the page the browser prints), "150" (left) next to "FREE" (right),
// at each paper size. The two pages are written by the proof test
// (SFL_FREE_PICTURES=docs/design/choose-price-free/stickers npx vitest run freeSticker.proof).
// Prints for each size: the word's box in mm, whether it is cut (must be false) and its letter size.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const DIR = __dirname;
const SIZES = [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60]];
const PX = 96 / 25.4;                                   // CSS px per mm
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  const lines = [];
  for (const [w, h] of SIZES) {
    const p = await b.newPage({ viewport: { width: Math.ceil((2 * w + 16) * PX), height: Math.ceil((h + 8) * PX) }, deviceScaleFactor: 4 });
    const frame = (f) => `<iframe src="file://${path.join(DIR, f)}" style="width:${w}mm;height:${h}mm;border:1px solid #707070;background:#fff;display:block"></iframe>`;
    // a local wrapper page (a blank page may not load local files into frames)
    const wrap = path.join(os.tmpdir(), `sfl-free-laptop-${w}x${h}.html`);
    fs.writeFileSync(wrap, `<!DOCTYPE html><body style="margin:0;background:#d8d8d8"><div style="display:flex;gap:6mm;padding:3mm">${frame("laptop-today-150.html")}${frame("laptop-today-FREE.html")}</div></body>`);
    await p.goto(`file://${wrap}`, { waitUntil: "load", timeout: 20000 });
    await p.waitForTimeout(200);
    const out = [];
    for (const f of p.frames().slice(1)) {
      out.push(await f.evaluate((mm) => {
        const c = document.querySelector(".code"), r = c.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(c); const t = range.getBoundingClientRect();
        return { text: c.textContent, cut: c.scrollWidth > c.clientWidth, wordMm: [(t.width / mm).toFixed(1), (t.height / mm).toFixed(1)], rightFreeMm: ((window.innerWidth - t.right) / mm).toFixed(1), bottomFreeMm: ((window.innerHeight - r.bottom) / mm).toFixed(1), fontMm: (parseFloat(getComputedStyle(c).fontSize) / mm).toFixed(1), pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1 };
      }, PX));
    }
    const [a, f] = out;
    if (f.cut || f.pageScrolls || Number(f.rightFreeMm) < 1 || f.fontMm !== a.fontMm) bad++;
    lines.push(`today | laptop page (browser)    | ${`${w}x${h}`.padEnd(6)} | FREE ${f.wordMm[0]}x${f.wordMm[1]} mm, letters ${f.fontMm} mm, cut: ${f.cut} | "150" ${a.wordMm[0]}x${a.wordMm[1]} mm, letters ${a.fontMm} mm | right edge free ${f.rightFreeMm} mm, bottom free ${f.bottomFreeMm} mm | one page: ${!f.pageScrolls}`);
    await p.screenshot({ path: path.join(DIR, `today_laptop_${w}x${h}.png`) });
    await p.close();
  }
  await b.close();
  console.log(lines.join("\n"));
  fs.writeFileSync(path.join(DIR, "measurements-laptop.txt"), lines.join("\n") + "\n");
  console.log(bad ? `\n${bad} size(s) with a problem` : "\nFREE is whole, on one page, same letter size as the price, at every size");
  process.exit(bad ? 1 : 0);
})();
