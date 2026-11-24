// Orders header: main vs this branch, measured in the real app (preview mode, made-up data).
//   main   = origin/main's preview     (npx vite --config vite.preview.config.ts --port 5198, in a main checkout)
//   branch = this checkout's preview   (npx vite --config vite.preview.config.ts --port 5199)
// For 8 languages × 360 / 390 / 430 / 1280 px, empty search box and with typed text:
//   • main: the search row's height (today's height);
//   • branch WITHOUT the live scanner (laptop / older app build / switch off): the same height, no Scan
//     button, and the whole Orders screen PIXEL-COMPARED with main (number of different pixels);
//   • branch WITH the live scanner (a fake scanner plugin, the switch on): the same height, the Scan button
//     inside the row, its tap area height, no sideways scroll;
//   • AT A 33px ROW (Jeff's phone — the row forced to 33px on BOTH main and the branch): the Scan tap area
//     (the smallest of 3 points across the button) ≥ 44px, and every neighbour — the Orders/Miners tabs, ✕,
//     the chips, Sessions — has exactly main's tap area (3 points each).
// Writes header-check.txt and shots/. Run: node docs/design/native-qr-scanner/header-check.cjs 5198 5199
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [MAIN, BRANCH] = [process.argv[2] || "5198", process.argv[3] || "5199"];
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [360, 390, 430, 1280];
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];

const FORCE_33 = "div:has(> input.sfl-header-search){height:33px !important;box-sizing:border-box !important}";
async function openOrders(b, port, w, lang, scanner, typed, force33 = false) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.addInitScript(([l, app, css]) => {
    try { localStorage.setItem("sfl_rd_lang", l); } catch {}
    if (app) window.Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr: async () => ({ status: "cancelled" }) } } };
    if (css) document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); });
  }, [lang, scanner, force33 ? FORCE_33 : ""]);
  await p.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  // the Orders tab = the 3rd button of the bottom bar (phone) or of the left side bar (laptop)
  await p.evaluate(() => {
    const all = [...document.querySelectorAll("button")].map((b) => ({ b, r: b.getBoundingClientRect() }));
    const bottom = all.filter((x) => x.r.top > window.innerHeight - 110).sort((a, b) => a.r.left - b.r.left);
    const side = all.filter((x) => x.r.left < 40 && x.r.top > 60).sort((a, b) => a.r.top - b.r.top);
    (bottom.length >= 5 ? bottom : side)[2].b.click();
  });
  const input = p.locator("input.sfl-header-search");
  await input.waitFor({ timeout: 8000 });
  if (typed) await input.fill("dress");
  await p.waitForTimeout(500);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.waitForTimeout(150);
  return { ctx, p };
}
// tap area of an element = how many pixel rows, at 3 points across it (left+2, middle, right-2), hit it
const rowOf = (p) => p.evaluate(() => {
  const run = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + 2, r.left + r.width / 2, r.right - 2].map((x) => {
      let n = 0;
      for (let y = Math.floor(r.top) - 40; y <= Math.ceil(r.bottom) + 40; y++) { const h = document.elementFromPoint(x, y); if (h === el || el.contains(h)) n++; }
      return n;
    });
  };
  const input = document.querySelector("input.sfl-header-search");
  const row = input.parentElement;
  const rr = row.getBoundingClientRect();
  const b = document.querySelector("[data-testid=ord-scan]");
  let tapH = null, inside = null, btnW = null;
  if (b) {
    const br = b.getBoundingClientRect();
    btnW = Math.round(br.width);
    inside = br.right <= rr.right + 1 && br.left >= rr.left;
    tapH = Math.min(...run(b));
  }
  const near = {};
  (row.previousElementSibling ? [...row.previousElementSibling.querySelectorAll("button")] : []).forEach((x, i) => { near["tab" + i] = run(x); });
  const clear = [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === "✕");
  if (clear) near.clear = run(clear);
  for (const x of document.querySelectorAll("[data-testid^=ord-pf-],[data-testid=ord-unpaid-pill],[data-testid=ord-range]")) near[x.dataset.testid] = run(x);
  return { rowH: Math.round(rr.height * 100) / 100, scan: !!b, tapH, inside, btnW, near, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

async function pixelDiff(page, a, b) {
  return page.evaluate(async ([a64, b64]) => {
    const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a64), load(b64)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return -1;
    const get = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = get(ia), db = get(ib); let n = 0; const W = ia.width; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let k = 0; k < da.length; k += 4) if (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2] || da[k + 3] !== db[k + 3]) {
      n++; const px = (k / 4) % W, py = Math.floor(k / 4 / W); x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    return n ? `${n} (at x ${x0}-${x1}, y ${y0}-${y1})` : 0;
  }, [a.toString("base64"), b.toString("base64")]);
}

(async () => {
  const b = await chromium.launch();
  const cmp = await (await b.newContext()).newPage();
  const lines = [];
  let bad = 0, noiseRetries = 0;
  for (const lang of LANGS) for (const w of WIDTHS) for (const typed of [false, true]) {
    // The "Session · N" pill renders a 3-pixel spot differently on some page loads — main compared with
    // ITSELF shows it too (control line at the end). So a difference is checked again on fresh loads (≤ 3).
    let diff = "?", tries = 0, mainRow, offRow;
    while (tries < 3) {
      tries++;
      const m = await openOrders(b, MAIN, w, lang, false, typed);
      mainRow = await rowOf(m.p);
      const off = await openOrders(b, BRANCH, w, lang, false, typed);
      offRow = await rowOf(off.p);
      diff = await pixelDiff(cmp, await m.p.screenshot(), await off.p.screenshot());
      await m.ctx.close();
      await off.ctx.close();
      if (diff === 0) break;
    }
    if (tries > 1 && diff === 0) noiseRetries++;
    const on = await openOrders(b, BRANCH, w, lang, true, typed);
    const onRow = await rowOf(on.p);
    if (lang === "en") await on.p.locator("input.sfl-header-search").locator("xpath=../..").screenshot({ path: path.join(OUT, `orders-header_${w}${typed ? "_typed" : ""}.png`) });
    await on.ctx.close();
    // Jeff's phone: a 33px row, on main and on the branch with the scanner
    const m33 = await openOrders(b, MAIN, w, lang, false, typed, true);
    const main33 = await rowOf(m33.p); await m33.ctx.close();
    const n33 = await openOrders(b, BRANCH, w, lang, true, typed, true);
    const new33 = await rowOf(n33.p);
    if (lang === "en") await n33.p.locator("input.sfl-header-search").locator("xpath=../..").screenshot({ path: path.join(OUT, `orders-header_${w}${typed ? "_typed" : ""}_row33.png`) });
    await n33.ctx.close();
    const lost = Object.keys(main33.near).filter((k) => JSON.stringify(main33.near[k]) !== JSON.stringify(new33.near[k] || null));
    const ok33 = main33.rowH === 33 && new33.rowH === 33 && new33.tapH >= 44 && lost.length === 0 && Object.keys(new33.near).length === Object.keys(main33.near).length;
    const ok = ok33 && offRow.rowH === mainRow.rowH && onRow.rowH === mainRow.rowH && !offRow.scan && onRow.scan && onRow.inside && onRow.tapH >= 44 && diff === 0 && onRow.sideways === 0 && offRow.sideways === 0;
    if (!ok) bad++;
    lines.push(`${ok ? "ok  " : "FAIL"} ${lang} ${w}px ${typed ? "typed" : "empty"}: row main ${mainRow.rowH}px · without scanner ${offRow.rowH}px, Scan button ${offRow.scan ? "SHOWN" : "none"}, pixels different from main ${diff} · with scanner ${onRow.rowH}px, Scan ${onRow.btnW}px inside=${onRow.inside} tap area ${onRow.tapH}px · sideways ${onRow.sideways}px · at a 33px row: Scan tap area ${new33.tapH}px, neighbours ${lost.length ? "CHANGED " + lost.map((k) => `${k} ${JSON.stringify(main33.near[k])}→${JSON.stringify(new33.near[k] || null)}`).join(" ") : `= main (${Object.keys(new33.near).length}: ${Object.entries(new33.near).map(([k, v]) => `${k} ${Math.min(...v)}`).join(", ")})`}`);
  }
  // control: main compared with itself, 10 times (the same page, two screenshots)
  let control = 0;
  for (let i = 0; i < 10; i++) {
    const a = await openOrders(b, MAIN, [360, 430][i % 2], ["th", "bg"][i % 2], false, false);
    const c = await openOrders(b, MAIN, [360, 430][i % 2], ["th", "bg"][i % 2], false, false);
    if ((await pixelDiff(cmp, await a.p.screenshot(), await c.p.screenshot())) !== 0) control++;
    await a.ctx.close(); await c.ctx.close();
  }
  await b.close();
  lines.push("", `${lines.length - bad} ok, ${bad} FAIL`,
    `pages loaded again because of the 3-pixel "Session" pill spot: ${noiseRetries} case(s), equal to main on the new load`,
    `control — main against main, 10 tries: ${control} differed`);
  fs.writeFileSync(path.join(__dirname, "header-check.txt"), lines.join("\n") + "\n");
  console.log(lines.slice(-12).join("\n"));
  process.exit(bad ? 1 : 0);
})();
