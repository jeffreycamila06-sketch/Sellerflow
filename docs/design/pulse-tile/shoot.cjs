// The REAL app (preview mode, made-up data) for Admin → Controls → the Live Pulse monitor tile:
//   iPhone app 390 (?apk=1&ios=1), Android app 360 (?apk=1), laptop 1280 — light + dark;
//   the four colours (38 / 64 / 72 of 100, and "—" when the server does not answer) and the panel opened
//   in the iPhone app. The live count is answered by a stand-in for the server route (page.route).
// Measured at 360 / 390 / 430 / 1280: nothing wider than the screen, the tile ≥ 44 px and as tall as the
// other tiles in its row.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/pulse-tile/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const usage = (n, lim) => JSON.stringify({ success: true, today: { count: 0, lastLabel: null, lastAt: null }, cooldowns: [], usage: { roomsToday: 140, concurrent: n, dailyLimit: 1000, concurrentLimit: lim, warn: false } });

async function open(b, { w, h, theme = "light", qs = "", live = 38, limit = 100, fail = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/admin/tiktok-cooldown/status*", (r) => fail ? r.abort() : r.fulfill({ status: 200, contentType: "application/json", body: usage(live, limit) }));
  await p.addInitScript((th) => { try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* nothing */ } }, theme);
  await p.goto(`http://localhost:${port}/?admin=1&pulse=1${qs}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 20 && !(await p.locator("[data-testid=admin-ctrl-pulse]").count()); i++) {
    await p.evaluate(() => [...document.querySelectorAll("button")].filter((x) => /^Admin$/.test((x.textContent || "").trim())).pop()?.click());
    await wait(p, 500);
  }
  await p.waitForSelector("[data-testid=admin-ctrl-pulse]");
  await wait(p, 600);
  return { p, errs, ctx };
}
const measure = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const tile = document.querySelector("[data-testid=admin-ctrl-pulse]");
  const r = tile.getBoundingClientRect();
  const next = tile.nextElementSibling.getBoundingClientRect();
  return { wide: document.documentElement.scrollWidth > vw + 1, out: r.right > vw + 0.5, h: Math.round(r.height), w: Math.round(r.width), sameRowH: Math.round(next.height), first: tile.parentElement.firstElementChild === tile, level: tile.getAttribute("data-level"), line: document.querySelector("[data-testid=admin-pulse-line]").textContent };
});
const shotControls = async (p, file) => {
  await p.evaluate(() => document.querySelector("[data-testid=admin-ctrl-pulse]").scrollIntoView({ block: "center" }));
  await wait(p, 300);
  await p.screenshot({ path: path.join(OUT, file) });
};

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, w, h, qs] of [["iphone390", 390, 844, "&apk=1&ios=1"], ["android360", 360, 800, "&apk=1"], ["laptop1280", 1280, 860, ""]]) {
    for (const theme of ["light", "dark"]) {
      const { p, errs, ctx } = await open(b, { w, h, theme, qs, live: 64 });
      await shotControls(p, `admin_${name}_${theme}.png`);
      const m = await measure(p);
      lines.push(`${name} ${theme}: level=${m.level} line="${m.line}" first=${m.first} tileH=${m.h} rowH=${m.sameRowH} wide=${m.wide} out=${m.out} errors=${errs.length}`);
      await ctx.close();
    }
  }
  // the four colours, close-up of the Controls grid (iPhone app, light + dark)
  for (const theme of ["light", "dark"]) {
    for (const [tag, o] of [["green_38", { live: 38 }], ["amber_64", { live: 64 }], ["red_72", { live: 72 }], ["grey_unknown", { fail: true }]]) {
      const { p, ctx } = await open(b, { w: 390, h: 844, theme, qs: "&apk=1&ios=1", ...o });
      await p.evaluate(() => document.querySelector("[data-testid=admin-ctrl-pulse]").scrollIntoView({ block: "center" }));
      await wait(p, 300);
      const grid = await p.evaluate(() => { const r = document.querySelector("[data-testid=admin-ctrl-pulse]").parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 220) }; });
      await p.screenshot({ path: path.join(OUT, `tile_${tag}_${theme}.png`), clip: { x: Math.max(0, grid.x - 6), y: Math.max(0, grid.y - 6), width: grid.width + 12, height: grid.height + 12 } });
      await ctx.close();
    }
  }
  // the panel opened in the iPhone app
  for (const theme of ["light", "dark"]) {
    const { p, ctx } = await open(b, { w: 390, h: 844, theme, qs: "&apk=1&ios=1", live: 64 });
    await p.evaluate(() => document.querySelector("[data-testid=admin-ctrl-pulse]").click());
    await wait(p, 900);
    await p.screenshot({ path: path.join(OUT, `panel_iphone390_${theme}.png`) });
    const txt = await p.evaluate(() => document.body.innerText);
    lines.push(`panel iphone390 ${theme}: money=${/NT\$|₱|\$|revenue|price/i.test(txt)} ttl=${txt.includes("live now 64/100")}`);
    await ctx.close();
  }
  for (const w of [360, 390, 430, 1280]) {
    const { p, errs, ctx } = await open(b, { w, h: 860, qs: w < 900 ? "&apk=1" : "", live: 72 });
    const m = await measure(p);
    const ok = !m.wide && !m.out && m.h >= 44 && m.h === m.sameRowH && m.first && errs.length === 0;
    lines.push(`${w}: ${ok ? "ok" : "PROBLEM"} level=${m.level} tile=${m.w}x${m.h} rowH=${m.sameRowH} wide=${m.wide} out=${m.out} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
