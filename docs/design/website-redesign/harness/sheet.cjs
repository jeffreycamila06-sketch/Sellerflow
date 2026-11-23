// Contact sheet: puts pictures side by side on one page (for looking at many at once).
// node docs/design/website-redesign/harness/sheet.cjs <out.jpg> <cell-width> <file> [file…]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const [out, w, ...files] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: files.length * (Number(w) + 16) + 16, height: 400 }, deviceScaleFactor: 1 });
  const cell = (f) => `<figure style="margin:0;width:${w}px"><figcaption style="font:600 12px system-ui;padding:0 0 6px;color:#333">${path.basename(f).replace(/\.jpg$/, "")}</figcaption><img src="data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}" style="width:100%;display:block;border:1px solid #bbb"></figure>`;
  await page.setContent(`<body style="margin:0;background:#e9e9ec"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start">${files.map(cell).join("")}</div></body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, type: "jpeg", quality: 82, fullPage: true });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
