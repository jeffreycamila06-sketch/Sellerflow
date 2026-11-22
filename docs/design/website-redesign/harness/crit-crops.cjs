// Design critique helper: cuts a tall "before" picture into pieces that can be read at full size.
// It only reads a JPEG from ../before and writes JPEGs to ../crops. It opens no shop page and no server.
// Run: node docs/design/website-redesign/harness/crit-crops.cjs <name-without-.jpg> <piece-height-px> <pieces-per-sheet>
//   e.g. node …/crit-crops.cjs brand-1-home_iphone390_full 1560 3
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const [name, hArg, perArg] = process.argv.slice(2);
  const pieceH = Number(hArg) || 1560;
  const per = Number(perArg) || 3;
  const src = path.join(__dirname, "..", "before", `${name}.jpg`);
  const out = path.join(__dirname, "..", "crops");
  fs.mkdirSync(out, { recursive: true });
  const data = `data:image/jpeg;base64,${fs.readFileSync(src).toString("base64")}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(`<img id="i" src="${data}">`);
  const { w, h } = await page.evaluate(() => { const i = document.getElementById("i"); return { w: i.naturalWidth, h: i.naturalHeight }; });
  const pieces = Math.ceil(h / pieceH);
  const made = [];
  for (let s = 0, sheet = 1; s < pieces; s += per, sheet++) {
    const n = Math.min(per, pieces - s);
    const cells = [];
    for (let k = 0; k < n; k++) {
      const top = (s + k) * pieceH;
      cells.push(`<div style="width:${w}px;height:${pieceH}px;overflow:hidden;background:#fff;outline:2px solid #888"><img src="${data}" style="display:block;margin-top:-${top}px"></div>`);
    }
    await page.setViewportSize({ width: n * (w + 12) + 12, height: pieceH + 24 });
    await page.setContent(`<body style="margin:0;background:#d8d8dc"><div style="display:flex;gap:12px;padding:12px">${cells.join("")}</div></body>`);
    await page.waitForTimeout(200);
    const f = path.join(out, `${name}_part${sheet}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 84 });
    made.push(path.basename(f));
  }
  await browser.close();
  console.log(`${name}: ${w}x${h} -> ${made.join(", ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
