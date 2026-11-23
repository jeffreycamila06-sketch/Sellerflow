// Pictures of the preview page: both hero directions at iPhone (390), Android (360) and laptop (1280),
// light and dark. First screen + the whole page.
//   node docs/design/landing-redesign/harness/shots.cjs
// Also writes shots/measure.txt: sideways scroll, small tap targets, images that did not load, first-load weight.
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "preview");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png" };
let served = [];
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  served.push(fs.statSync(f).size);
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
const DEVICES = [["iphone-390", 390, 844], ["android-360", 360, 780], ["laptop-1280", 1280, 800]];
(async () => {
  await new Promise((r) => server.listen(5210, r));
  const b = await chromium.launch();
  const lines = [];
  for (const hero of ["a", "b"]) for (const [dev, w, h] of DEVICES) for (const dark of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    served = [];
    await p.goto(`http://localhost:5210/?static#hero-${hero}`, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    const first = served.reduce((x, y) => x + y, 0), files = served.length;   // the page's own files before any scrolling (fonts not counted)
    const name = `hero-${hero}_${dev}${dark ? "_dark" : ""}`;
    await p.screenshot({ path: path.join(OUT, `${name}_first-screen.png`) });
    // load every lazy picture, then the whole page
    const total = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += h) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(120); }
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    await p.evaluate(() => { const f = document.querySelector(".fab"); if (f) f.style.position = "absolute"; const n = document.querySelector(".nav"); if (n) n.style.position = "static"; });
    // the whole page: a lighter picture (1x, JPEG) from a second window
    const ctx1 = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
    const p1 = await ctx1.newPage();
    await p1.goto(`http://localhost:5210/?static#hero-${hero}`, { waitUntil: "networkidle" });
    await p1.evaluate(() => document.fonts.ready);
    for (let y = 0; y < total; y += h) { await p1.evaluate((yy) => window.scrollTo(0, yy), y); await p1.waitForTimeout(120); }
    await p1.evaluate(() => { window.scrollTo(0, 0); const f = document.querySelector(".fab"); if (f) f.style.position = "absolute"; const n = document.querySelector(".nav"); if (n) n.style.position = "static"; });
    await p1.waitForTimeout(300);
    await p1.screenshot({ path: path.join(OUT, `${name}_whole-page.jpg`), fullPage: true, type: "jpeg", quality: 80 });
    await ctx1.close();
    const m = await p.evaluate(() => {
      const de = document.documentElement;
      const small = [...document.querySelectorAll("a.btn, button, a.store, summary, a.fab")].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).map((el) => `${(el.textContent || "").trim().slice(0, 18)}=${Math.round(el.getBoundingClientRect().height)}`);
      const broken = [...document.images].filter((i) => i.offsetParent !== null && !i.hasAttribute("data-src") && (!i.complete || i.naturalWidth === 0)).length;   // the demo's other frames are fetched later on purpose
      const wide = [...document.querySelectorAll("body *")].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > de.clientWidth + 1 && !el.closest(".tblwrap, .roll")).slice(0, 3).map((el) => el.className || el.tagName);
      return { sideways: de.scrollWidth > de.clientWidth + 1, small, broken, height: de.scrollHeight, wide };
    });
    lines.push(`${name.padEnd(30)} | sideways scroll: ${m.sideways ? "YES (" + m.wide.join(", ") + ")" : "no"} | tap targets under 44 px: ${m.small.length ? m.small.join(", ") : "none"} | pictures not loaded: ${m.broken} | page height ${m.height}px | first load before scrolling: ${files} files, ${Math.round(first / 1024)} KB${errs.length ? " | ERRORS: " + errs.join("; ") : ""}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "measure.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close(); server.close();
})();
