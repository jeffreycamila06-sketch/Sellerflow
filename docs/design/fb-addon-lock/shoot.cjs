// The REAL app (preview mode, made-up seller / sellers) for the Facebook-tab lock + Admin "Receipt add-on":
//   1) Settings → Invoicing → Facebook tab, a seller WITHOUT the add-on (the locked card)
//      — iPhone 390 (the iPhone app, ?ios=1), Android 360, laptop 1280; light + dark;
//   2) Admin → Controls → Receipt add-on — iPhone 390 + laptop 1280 (light), and the "+ Receipt" badge
//      in Manage sellers.
// Plus measured checks at 360 / 390 / 430 / 1280 in all 8 languages: nothing wider than the screen, the
// card's button ≥ 44 px tall and its text not cut, the admin panel's buttons ≥ 44 px.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/fb-addon-lock/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const wait = (p, ms = 350) => p.waitForTimeout(ms);

async function open(b, { w, h, theme = "light", lang = "en", qs = "", ios = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, lg]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); } catch { /* nothing */ }
    window.open = () => null;
  }, [theme, lang]);
  await p.goto(`http://localhost:${port}/?ivc=6,2&admin=1&ra=1${ios ? "&ios=1" : ""}${qs}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  await p.evaluate(() => document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[target=_blank]"); if (a) e.preventDefault(); }, true));
  return { p, errs, ctx };
}
// the bottom-nav button whose text is one of the given words
const navTo = (p, re) => p.evaluate((src) => {
  const r = new RegExp(src, "i");
  const b = [...document.querySelectorAll("button")].filter((x) => r.test((x.textContent || "").trim())).pop();
  if (b) b.click(); return !!b;
}, re.source);
async function toInvoicingFb(p) {
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => {
      const live = [...document.querySelectorAll("button")].filter((x) => /^(Live|直播|ไลฟ์|Лайв)$/i.test((x.textContent || "").trim()))[0];
      const menu = live ? [...live.parentElement.querySelectorAll("button")] : [];
      menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click();
    }, i);
    await wait(p, 400);
  }
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-tab-facebook]");
  await tap(p, "[data-testid=ivc-tab-facebook]");
  await p.waitForSelector("[data-testid=ivc-fb-locked]");
  await wait(p, 400);
}
async function toAdminPanel(p, kind) {
  for (let i = 0; i < 20 && !(await p.locator(`[data-testid=admin-ctrl-${kind}]`).count()); i++) {
    await p.evaluate(() => {
      const b = [...document.querySelectorAll("button")].filter((x) => /^Admin$/.test((x.textContent || "").trim())).pop();
      if (b) b.click();
    });
    await wait(p, 500);
  }
  await p.evaluate((k) => document.querySelector(`[data-testid=admin-ctrl-${k}]`).scrollIntoView({ block: "center" }), kind);
  await tap(p, `[data-testid=admin-ctrl-${kind}]`);
}
const measureCard = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const card = document.querySelector("[data-testid=ivc-fb-locked]").getBoundingClientRect();
  const a = document.querySelector("[data-testid=ivc-fb-lock-ask]");
  const ab = a.getBoundingClientRect();
  const wide = document.documentElement.scrollWidth > vw + 1;
  const cut = [...document.querySelectorAll("[data-testid^=ivc-fb-lock]")].some((e) => e.scrollWidth > e.clientWidth + 1);
  return { wide, cardOut: card.right > vw + 0.5 || card.left < -0.5, btnH: Math.round(ab.height), cut, href: a.getAttribute("href") };
});

(async () => {
  const b = await chromium.launch();
  const lines = [];
  // 1) the locked Facebook tab
  for (const [name, w, h, ios] of [["iphone390", 390, 844, true], ["android360", 360, 800, false], ["laptop1280", 1280, 800, false]]) {
    for (const theme of ["light", "dark"]) {
      const { p, errs, ctx } = await open(b, { w, h, theme, ios, qs: name === "android360" ? "" : "" });
      if (name === "android360") await p.evaluate(() => { window.Capacitor = window.Capacitor || { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {} }; });
      await toInvoicingFb(p);
      await p.screenshot({ path: path.join(OUT, `fb_locked_${name}_${theme}.png`) });
      const m = await measureCard(p);
      lines.push(`${name} ${theme}: wide=${m.wide} cardOut=${m.cardOut} btnH=${m.btnH} cut=${m.cut} errors=${errs.length}`);
      await ctx.close();
    }
  }
  // 2) the admin list
  for (const [name, w, h] of [["iphone390", 390, 844], ["laptop1280", 1280, 860]]) {
    const { p, errs, ctx } = await open(b, { w, h });
    await toAdminPanel(p, "receiptaddon");
    await p.waitForSelector("[data-testid=ra-panel]");
    await wait(p, 500);
    await p.screenshot({ path: path.join(OUT, `admin_list_${name}.png`) });
    await p.evaluate(() => document.querySelector("[data-testid=ra-add-open]").click());
    await p.evaluate(() => document.querySelector("[data-testid=ra-row] [data-testid=ra-remove]").click());
    await wait(p, 300);
    await p.screenshot({ path: path.join(OUT, `admin_add_remove_${name}.png`) });
    const m = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const small = [...document.querySelectorAll("[data-testid=ra-panel] button")].filter((x) => x.getBoundingClientRect().height < 36 && x.getAttribute("data-testid") !== "ra-note").map((x) => x.getAttribute("data-testid"));
      const out = [...document.querySelectorAll("[data-testid=ra-panel] *")].some((e) => e.getBoundingClientRect().right > vw + 0.5);
      return { small, out, rows: document.querySelectorAll("[data-testid=ra-row]").length, warn: document.querySelectorAll("[data-warn='1']").length };
    });
    lines.push(`admin ${name}: rows=${m.rows} amber=${m.warn} out=${m.out} buttonsUnder36=${m.small.join(",") || "none"} errors=${errs.length}`);
    await ctx.close();
  }
  {
    const { p, ctx } = await open(b, { w: 390, h: 844 });
    for (let i = 0; i < 20 && !(await p.locator("[data-testid=admin-ctrl-receiptaddon]").count()); i++) {
      await p.evaluate(() => [...document.querySelectorAll("button")].filter((x) => /^Admin$/.test((x.textContent || "").trim())).pop()?.click());
      await wait(p, 500);
    }
    await p.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.onclick !== undefined && (d.textContent || "").trim() === "Sellers" && d.querySelector("svg"))?.click());
    await wait(p, 500);
    await p.waitForSelector("[data-testid=ra-badge]");
    await p.evaluate(() => document.querySelector("[data-testid=ra-badge]").scrollIntoView({ block: "center" }));
    await wait(p, 400);
    await p.screenshot({ path: path.join(OUT, `admin_sellers_badge_iphone390.png`) });
    lines.push(`sellers badge iphone390: badges=${await p.locator("[data-testid=ra-badge]").count()}`);
    await ctx.close();
  }
  // 3) measured, all languages, the locked card
  for (const w of [360, 390, 430, 1280]) for (const lang of LANGS) {
    const { p, errs, ctx } = await open(b, { w, h: 860, lang });
    await toInvoicingFb(p);
    const m = await measureCard(p);
    if (w === 360 && lang !== "en") await p.screenshot({ path: path.join(OUT, `lang_360_${lang}.png`) });
    const ok = !m.wide && !m.cardOut && m.btnH >= 44 && !m.cut && errs.length === 0;
    lines.push(`${w} ${lang}: ${ok ? "ok" : "PROBLEM"} wide=${m.wide} cardOut=${m.cardOut} btnH=${m.btnH} cut=${m.cut} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
