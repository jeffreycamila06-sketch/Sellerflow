// node docs/design/fm-pickup-accuracy-2/harness/wrap-check.cjs [out.txt]
// The REAL screen (harness on port 5331), In transit list. For every right-hand line ("Drop off before …",
// "Leaves this list …", "… at the next check") it reads where each character really sits on screen and
// prints the lines as the seller sees them. Flags: a line holding ONE character (orphan), and a date
// cut over two lines. iPhone 390, Android 360, laptop 1280; the app's 8 languages.
const { chromium } = require("playwright");
const fs = require("fs");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
(async () => {
  const b = await chromium.launch();
  const out = [];
  let orphans = 0, cutDates = 0, rows = 0;
  for (const [dev, w, h] of DEVICES) for (const lang of LANGS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(`http://localhost:5331/docs/design/fm-pickup-accuracy-2/harness/index.html?lang=${lang}`, { waitUntil: "networkidle" });
    await p.waitForSelector(w < 700 ? "[data-testid=pt-cards]" : "[data-testid=pt-tabs]");
    await p.click(w < 700 ? "[data-testid=pt-card-transit]" : "[data-testid=pt-tab-transit]");
    await p.waitForSelector("[data-testid=pt-fm-group]");
    const res = await p.evaluate(() => {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const cells = [...document.querySelectorAll('[data-testid="pt-row"] [data-testid="pt-left"]')]
        .filter((e) => e.hasAttribute("data-dropoff") || e.hasAttribute("data-leaves"));
      return cells.map((cell) => {
        const lines = new Map();
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          let i = 0;
          for (const { segment } of seg.segment(n.textContent)) {
            const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + segment.length); i += segment.length;
            const rect = r.getClientRects()[0]; if (!rect || !rect.width) continue;
            const top = Math.round(rect.top);
            const key = [...lines.keys()].find((k) => Math.abs(k - top) <= 3) ?? top;
            lines.set(key, (lines.get(key) || "") + segment);
          }
        }
        const list = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s.trim()).filter(Boolean);
        const date = cell.querySelector("[data-date]");
        const dateLines = date ? new Set([...date.getClientRects()].map((r) => Math.round(r.top))).size : null;
        return { who: cell.closest('[data-testid="pt-row"]').querySelector('span[title^="@"]')?.getAttribute("title"), lines: list, dateLines,
          overflow: cell.scrollWidth > cell.clientWidth + 1 };
      });
    });
    for (const r of res) {
      rows++;
      const orphan = r.lines.some((l) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(l.replace(/\s/g, ""))].length === 1);
      const cut = r.dateLines !== null && r.dateLines > 1;
      orphans += orphan; cutDates += cut;
      out.push(`${dev.padEnd(10)} ${lang.padEnd(5)} ${String(r.who).padEnd(10)} ${r.lines.join("  ⏎  ")}${orphan ? "   ← ONE-CHARACTER LINE" : ""}${cut ? "   ← DATE CUT" : ""}${r.overflow ? "   ← OVERFLOW" : ""}`);
    }
    await p.close();
  }
  out.push(`lines checked: ${rows} · one-character lines: ${orphans} · dates cut over two lines: ${cutDates}`);
  await b.close();
  const text = out.join("\n");
  console.log(text);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], text + "\n");
})();
