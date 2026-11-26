// The REAL app (preview mode, made-up seller and buyers) → Settings → Invoicing, TikTok tab:
//   1) a row sheet with one item cancelled (struck through + Undo);
//   2) "Add @buyer to Blacklist?" right after "Buyer cancelled";
//   3) the list with the cancelled buyer (dimmed, "Cancelled", total struck through).
// iPhone 390, Android 360, laptop 1280, light + dark. Plus measured checks at 360 / 390 / 430 / 1280 in all
// 8 languages: nothing wider than the screen, the cancelled row's total + View stay on one line each, the
// sheet's struck line and its Undo fit, the Blacklist question's buttons are 44 px+.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/invoicing-cancel/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const DEVICES = [["iphone390", 390, 844], ["android360", 360, 800], ["laptop1280", 1280, 800]];
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const wait = (p, ms = 350) => p.waitForTimeout(ms);

async function open(b, { w, h, theme = "light", lang = "en" }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  ctx.on("page", (pg) => { if (pg !== p) pg.close().catch(() => {}); });
  await p.addInitScript(([th, lg]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); } catch { /* nothing */ }
    window.open = () => null;
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() } }); } catch { /* nothing */ }
  }, [theme, lang]);
  await p.goto(`http://localhost:${port}/?ivc=40,12&ivclong=1&admin=1&bl=1`, { waitUntil: "networkidle" });
  await wait(p, 900);
  await p.evaluate(() => document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[target=_blank]"); if (a) e.preventDefault(); }, true));
  return { p, errs, ctx };
}
async function toInvoicing(p) {
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => {
      const live = [...document.querySelectorAll("button")].filter((x) => /^(Live|直播|ไลฟ์|Лайв)$/i.test((x.textContent || "").trim()))[0];
      const menu = live ? [...live.parentElement.querySelectorAll("button")] : [];
      menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click();
    }, i);
    await wait(p, 400);
  }
  await p.waitForSelector("[data-testid=tile-invoicing]");
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-row]");
  await wait(p, 500);
}
const view = (n) => `[data-testid=ivc-row][data-buyer="${n}"] [data-testid=ivc-row-view]`;
async function flow(p, shot) {
  // 1) #15 (two items): cancel the first one
  await tap(p, view(15)); await p.waitForSelector("[data-testid=tts-sheet]");
  await p.evaluate(() => document.querySelector("[data-testid=tts-line] [data-testid=tts-remove]").click());
  await p.waitForSelector("[data-testid=tts-line-cancelled]");
  await p.evaluate(() => document.querySelector("[data-testid=tts-line-cancelled]").scrollIntoView({ block: "center" }));
  await wait(p);
  if (shot) await p.screenshot({ path: shot("sheet_item") });
  const sheet = await p.evaluate(() => {
    const vw = window.innerWidth;
    const line = document.querySelector("[data-testid=tts-line-cancelled]").getBoundingClientRect();
    const undo = document.querySelector("[data-testid=tts-line-undo]").getBoundingClientRect();
    return { over: line.right > vw + 0.5 || undo.right > vw + 0.5, undoH: undo.height, struck: getComputedStyle(document.querySelector("[data-testid=tts-cut-text]")).textDecorationLine };
  });
  await tap(p, "[data-testid=tts-close]"); await wait(p);
  // 2) #14: Buyer cancelled → the Blacklist question
  await tap(p, view(14)); await p.waitForSelector("[data-testid=tts-cancel-buyer]");
  await tap(p, "[data-testid=tts-cancel-buyer]");
  await p.waitForSelector("[data-testid=ivc-bl-ask]"); await wait(p);
  if (shot) await p.screenshot({ path: shot("blacklist_ask") });
  const ask = await p.evaluate(() => {
    const vw = window.innerWidth;
    const b = [...document.querySelectorAll("[data-testid=ivc-bl-yes],[data-testid=ivc-bl-no]")].map((x) => x.getBoundingClientRect());
    return { over: b.some((r) => r.right > vw + 0.5 || r.left < -0.5), minH: Math.min(...b.map((r) => r.height)) };
  });
  await tap(p, "[data-testid=ivc-bl-no]"); await wait(p);
  // 3) the list around the cancelled row
  await p.evaluate(() => document.querySelector('[data-testid=ivc-row][data-buyer="14"]').scrollIntoView({ block: "center" }));
  await wait(p);
  if (shot) await p.screenshot({ path: shot("list_cancelled") });
  const list = await p.evaluate(() => {
    const vw = window.innerWidth;
    const r = document.querySelector('[data-testid=ivc-row][data-buyer="14"]');
    const tot = r.querySelector("[data-testid=ivc-row-total]"), v = r.querySelector("[data-testid=ivc-row-view]");
    const lh = (el) => parseFloat(getComputedStyle(el).lineHeight) || 16;
    return {
      wide: document.documentElement.scrollWidth > vw, tag: r.getAttribute("data-tag"),
      totalWraps: tot.getBoundingClientRect().height > lh(tot) * 1.5, viewWraps: v.getBoundingClientRect().height > 34,
      over: r.getBoundingClientRect().right > vw + 0.5 || v.getBoundingClientRect().right > r.getBoundingClientRect().right + 0.5,
      struck: getComputedStyle(tot).textDecorationLine, progress: document.querySelector("[data-testid=ivc-progress-text]").textContent,
    };
  });
  return { sheet, ask, list };
}
(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [dev, w, h] of DEVICES) for (const theme of ["light", "dark"]) {
    const { p, errs, ctx } = await open(b, { w, h, theme });
    await toInvoicing(p);
    const m = await flow(p, (name) => path.join(OUT, `${name}_${dev}_${theme}.png`));
    lines.push(`${dev} ${theme}: ${JSON.stringify(m)} errors=${errs.length}`);
    await ctx.close();
  }
  for (const w of [360, 390, 430, 1280]) for (const lang of LANGS) {
    const { p, errs, ctx } = await open(b, { w, h: 900, lang });
    await toInvoicing(p);
    const m = await flow(p, w === 360 && lang !== "en" ? (name) => path.join(OUT, `lang_360_${lang}_${name}.png`) : null);
    const ok = !m.sheet.over && m.sheet.undoH >= 44 && m.sheet.struck === "line-through" && !m.ask.over && m.ask.minH >= 44
      && !m.list.wide && m.list.tag === "cancelled" && !m.list.totalWraps && !m.list.viewWraps && !m.list.over && m.list.struck === "line-through" && errs.length === 0;
    lines.push(`${w} ${lang}: ${ok ? "ok" : "PROBLEM " + JSON.stringify(m)} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
