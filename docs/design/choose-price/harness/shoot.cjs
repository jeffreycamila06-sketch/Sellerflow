// node docs/design/choose-price/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// iPhone 390, Android 360, laptop 1280 — Live setup (OFF / ON) and the pop-up (single / queued).
// Prints for every picture: sideways page scroll, the smallest price-button / switch height.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const WIDTHS = [["iphone-390", 390, 844], ["android-360", 360, 800], ["laptop-1280", 1280, 800]];
const VIEWS = ["settings-off", "settings-on", "pop-single", "pop-queued"];
(async () => {
  const b = await chromium.launch();
  for (const v of VIEWS) for (const [label, w, h] of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/choose-price/harness/index.html?view=${v}`, { waitUntil: "networkidle" });
    if (v.startsWith("settings")) {
      await p.waitForSelector("[data-testid=cpp-row]");
      await p.evaluate(() => document.querySelector("[data-testid=samePrice-row]").scrollIntoView({ block: "start" }));
      await p.evaluate(() => window.scrollBy(0, -140));
    } else await p.waitForSelector("[data-testid=cpp-sheet]");
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const hs = (sel) => [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().height));
      return {
        sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        priceBtnMinH: Math.min(...hs("[data-testid^=cpp-price-]"), 999),
        chipMinH: Math.min(...hs("[data-testid^=cpp-chip-]"), 999),
        sheet: (() => { const s = document.querySelector("[data-testid=cpp-sheet]"); if (!s) return null; const r = s.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; })(),
      };
    });
    await p.screenshot({ path: path.join(OUT, `${v}_${label}.png`) });
    console.log(v, label, JSON.stringify(m));
    await p.close();
  }
  await b.close();
})();
