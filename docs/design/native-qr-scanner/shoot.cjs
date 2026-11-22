// The REAL app (preview mode, made-up data from src/dev/fakeSupabase.ts) → Orders. On phone and laptop
// widths and in 4 languages it checks the search row with the new Scan button: one line, the same
// height as the search box needs, nothing sideways, and a 44 px tap area. Saves a picture of the header.
//   server: npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/native-qr-scanner/shoot.cjs 5199
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [360, 390, 430, 1280];
const LANGS = ["en", "fil", "bg", "th"];

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const lang of LANGS) for (const w of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: 800 }, deviceScaleFactor: lang === "en" ? 2 : 1 });
    await p.addInitScript((l) => { try { localStorage.setItem("sfl_rd_lang", l); } catch {} }, lang);
    await p.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    // The Orders tab = the 3rd button of the bottom bar (phone) or of the left sidebar (laptop);
    // the label is translated, so it is found by place.
    await p.evaluate(() => {
      const all = [...document.querySelectorAll("button")].map((b) => ({ b, r: b.getBoundingClientRect() }));
      const bottom = all.filter((x) => x.r.top > window.innerHeight - 110).sort((a, b) => a.r.left - b.r.left);
      const side = all.filter((x) => x.r.left < 40 && x.r.top > 60).sort((a, b) => a.r.top - b.r.top);
      (bottom.length >= 5 ? bottom : side)[2].b.click();
    });
    const btn = p.locator("[data-testid=ord-scan]");
    await btn.waitFor({ timeout: 8000 });
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const b = document.querySelector("[data-testid=ord-scan]");
      const row = b.parentElement;
      const input = row.querySelector("input:not([type=file])");
      const br = b.getBoundingClientRect(), rr = row.getBoundingClientRect(), ir = input.getBoundingClientRect();
      // Tap area = how many pixels, top to bottom along the button's middle, a tap lands on the button.
      let tapH = 0;
      for (let y = Math.floor(br.top) - 40; y <= Math.ceil(br.bottom) + 40; y++) {
        const h = document.elementFromPoint(br.left + br.width / 2, y);
        if (h === b || b.contains(h)) tapH++;
      }
      return {
        rowH: Math.round(rr.height), oneLine: Math.abs(br.top + br.height / 2 - (ir.top + ir.height / 2)) < 4,
        inputW: Math.round(ir.width), btnW: Math.round(br.width), btnText: b.textContent,
        insideRow: br.right <= rr.right + 1 && br.left >= rr.left,
        tapH,
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    if (lang === "en") await p.locator("[data-testid=ord-scan]").locator("xpath=../..").screenshot({ path: path.join(OUT, `orders-header_${w}.png`) });
    lines.push(`${lang} ${w}px: row ${m.rowH}px one line=${m.oneLine} · search box ${m.inputW}px · Scan "${m.btnText}" ${m.btnW}px inside the row=${m.insideRow} · tap area ${m.tapH}px tall · sideways scroll=${m.sideways}px`);
    await p.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "header-check.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
