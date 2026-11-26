// The REAL app (preview mode, made-up free sellers) for Admin → Free tier: groups, chips, last order,
// look-alike rows and the group sheet — iPhone 390, Android 360, laptop 1280; light + dark.
// Measured at 360 / 390 / 430 / 1280: nothing wider than the screen, chips + sheet Close ≥ 44 px.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/free-tier-active/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const wait = (p, ms = 350) => p.waitForTimeout(ms);

async function open(b, { w, h, theme = "light" }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript((th) => { try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* nothing */ } }, theme);
  await p.goto(`http://localhost:${port}/?admin=1&ft=1`, { waitUntil: "networkidle" });
  await wait(p, 900);
  return { p, errs, ctx };
}
async function toFreeTier(p) {
  for (let i = 0; i < 20; i++) {
    const found = await p.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Free tier/i.test(x.textContent || "") && /\d/.test(x.textContent || ""));
      if (b) { b.click(); return true; }
      [...document.querySelectorAll("button")].filter((x) => /^Admin$/.test((x.textContent || "").trim())).pop()?.click();
      return false;
    });
    await wait(p, 500);
    if (found) break;
  }
  await p.waitForSelector("[data-testid=ft-list]");
  await p.waitForSelector("[data-testid=ft-last]");
  await wait(p, 600);
}
const measure = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const wide = document.documentElement.scrollWidth > vw + 1;
  const chips = [...document.querySelectorAll("[data-testid^=ft-chip-]")].map((c) => Math.round(c.getBoundingClientRect().height));
  const out = [...document.querySelectorAll("[data-testid=ft-list] *")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5; });
  const close = document.querySelector("[data-testid=ft-sheet-close]");
  const sheetOut = [...document.querySelectorAll("[data-testid=ft-sheet] *")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5; });
  return { wide, out, chips: chips.join("/"), closeH: close ? Math.round(close.getBoundingClientRect().height) : null, sheetOut,
    rows: document.querySelectorAll("[data-testid=ft-row]").length, amber: document.querySelectorAll("[data-testid=ft-row][data-look='1']").length };
});

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, w, h] of [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 860]]) {
    for (const theme of ["light", "dark"]) {
      const { p, errs, ctx } = await open(b, { w, h, theme });
      await toFreeTier(p);
      await p.screenshot({ path: path.join(OUT, `list_${name}_${theme}.png`) });
      await tap(p, "[data-testid=ft-chip-look]");
      await wait(p);
      await p.screenshot({ path: path.join(OUT, `filter_lookalike_${name}_${theme}.png`) });
      await tap(p, "[data-testid=ft-row][data-look='1']");
      await wait(p, 500);
      await p.screenshot({ path: path.join(OUT, `sheet_${name}_${theme}.png`) });
      const m = await measure(p);
      lines.push(`${name} ${theme}: wide=${m.wide} listOut=${m.out} chipsH=${m.chips} sheetCloseH=${m.closeH} sheetOut=${m.sheetOut} errors=${errs.length}`);
      await ctx.close();
    }
  }
  for (const w of [360, 390, 430, 1280]) {
    const { p, errs, ctx } = await open(b, { w, h: 860 });
    await toFreeTier(p);
    const a = await measure(p);
    await tap(p, "[data-testid=ft-chip-active]"); await wait(p);
    const act = await p.locator("[data-testid=ft-row]").count();
    await tap(p, "[data-testid=ft-chip-all]"); await wait(p);
    await tap(p, "[data-testid=ft-row][data-look='1']"); await wait(p, 500);
    const s = await measure(p);
    const ok = !a.wide && !a.out && a.chips.split("/").every((n) => +n >= 44) && s.closeH >= 44 && !s.sheetOut && errs.length === 0;
    lines.push(`${w}: ${ok ? "ok" : "PROBLEM"} rows=${a.rows} amber=${a.amber} active7=${act} wide=${a.wide} out=${a.out} chipsH=${a.chips} sheetCloseH=${s.closeH} sheetOut=${s.sheetOut} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
