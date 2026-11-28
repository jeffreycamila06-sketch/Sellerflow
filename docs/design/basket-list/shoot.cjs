// The REAL app (preview mode, made-up seller + buyers, ?bk=1) for the BASKET LIST: Live screen → tap 🛒N →
// the buyer's list (scrolls, no "See all") → Cancel → the question → Cancelled + Undo. Free plan = no tap.
// iPhone 390 (?ios=1), Android 412, small phone 360, laptop 1280, + dark. Measured: no sideways scroll,
// button heights, tap areas, the sheet above the bottom bar.
//   server:  node_modules/.bin/vite --config vite.preview.config.ts --port 5199
//   NODE_PATH=/opt/node-tools/node_modules node docs/design/basket-list/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);

async function open(b, { w, h, theme = "light", ios = false, android = false, free = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, and]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* */ }
    if (and) window.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {} };
  }, [theme, android]);
  await p.goto(`http://localhost:${port}/?bk=1${free ? "&bkfree=1" : ""}${ios ? "&ios=1" : ""}`, { waitUntil: "networkidle" });
  await wait(p, 1500);
  for (let i = 0; i < 20 && !(await p.evaluate(() => typeof window.__sflInject === "function")); i++) await wait(p, 300);
  for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__sflInject()); await wait(p, 150); }
  await wait(p, 600);
  return { p, errs, ctx };
}
async function measure(p, w, label) {
  return p.evaluate(([w, label]) => {
    const wide = document.documentElement.scrollWidth > w + 1 ? `PAGE ${document.documentElement.scrollWidth}px WIDE` : "no sideways scroll";
    const out = [label, wide];
    const badge = document.querySelector("[data-testid=basket-badge-btn]");
    if (badge) {
      const r = badge.getBoundingClientRect(); const a = getComputedStyle(badge, "::after");
      out.push(`badge ${Math.round(r.width)}×${Math.round(r.height)} drawn, tap area ${a.content !== "none" ? `${Math.round(r.width + 6)}×${Math.max(Math.round(r.height), parseFloat(a.height) || 0)}` : "none"}`);
    } else out.push(`plain badges=${document.querySelectorAll("span.sfl-basket-badge").length}`);
    const panel = document.querySelector("[data-testid=bk-panel]");
    if (panel) {
      const r = panel.getBoundingClientRect();
      out.push(`sheet ${Math.round(r.width)}×${Math.round(r.height)} (screen ${window.innerHeight}), bottom ${Math.round(r.bottom)}`);
      const list = document.querySelector("[data-testid=bk-list]");
      if (list) out.push(`list scrolls=${list.scrollHeight > list.clientHeight + 1}`);
      const hs = [...panel.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => `${b.dataset.testid}:${Math.round(b.getBoundingClientRect().height)}`);
      out.push(`buttons ${hs.join(" ")}`);
      const over = [...panel.querySelectorAll("*")].some((e) => e.getBoundingClientRect().right > r.right + 1);
      out.push(over ? "SOMETHING STICKS OUT" : "nothing sticks out");
      // the panel is the top element at its own bottom-centre (not covered by the bottom bar)
      const top = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6);
      out.push(panel.contains(top) ? "panel on top at its bottom edge" : `COVERED by ${top && top.className}`);
    }
    return out.join(" | ");
  }, [w, label]);
}

(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const lines = [];
  const views = [
    { name: "iphone-390", w: 390, h: 844, ios: true },
    { name: "android-412", w: 412, h: 915, android: true },
    { name: "phone-360", w: 360, h: 640 },
    { name: "laptop-1280", w: 1280, h: 820 },
    { name: "iphone-390-dark", w: 390, h: 844, ios: true, theme: "dark" },
  ];
  for (const v of views) {
    const { p, errs, ctx } = await open(b, v);
    await p.screenshot({ path: path.join(OUT, `${v.name}-1-live.png`) });
    lines.push(await measure(p, v.w, `${v.name} live`));
    // the buyer with the most orders (Aileen Go, 🛒3)
    await p.evaluate(() => { const b = [...document.querySelectorAll("[data-testid=basket-badge-btn]")].find((x) => x.textContent === "🛒3"); b.click(); });
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `${v.name}-2-list.png`) });
    lines.push(await measure(p, v.w, `${v.name} list`));
    await tap(p, "[data-testid=bk-cancel]");
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `${v.name}-3-question.png`) });
    lines.push(await measure(p, v.w, `${v.name} question`));
    await tap(p, "[data-testid=bk-cx-yes]");
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `${v.name}-4-cancelled.png`) });
    lines.push(await measure(p, v.w, `${v.name} after cancel`));
    await tap(p, "[data-testid=bk-reprint]");
    await wait(p, 300);
    await p.screenshot({ path: path.join(OUT, `${v.name}-5-reprinting.png`) });
    lines.push(`${v.name} chips=${await p.locator("[data-testid=bk-cx-chip]").count()} undo=${await p.locator("[data-testid=bk-undo]").count()} errors=${errs.length ? errs.join(" | ") : "none"}`);
    await ctx.close();
  }
  // free plan: the badge is the plain number, tapping does nothing
  const { p, errs, ctx } = await open(b, { w: 390, h: 844, ios: true, free: true });
  await p.screenshot({ path: path.join(OUT, "iphone-390-free-plan.png") });
  lines.push(await measure(p, 390, "free plan"));
  await p.evaluate(() => { const s = [...document.querySelectorAll("span.sfl-basket-badge")][0]; s && s.click(); });
  await wait(p, 400);
  lines.push(`free plan: sheet after tap=${await p.locator("[data-testid=bk-sheet]").count()} errors=${errs.length ? errs.join(" | ") : "none"}`);
  await ctx.close();
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();

// many orders: the list scrolls inside the sheet (no "See all"), iPhone + laptop, top and scrolled to the end
(async () => {
  await new Promise((r) => setTimeout(r, 0));
  if (process.env.SHOOT_MANY !== "1") return;
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  for (const v of [{ name: "iphone-390", w: 390, h: 844 }, { name: "laptop-1280", w: 1280, h: 820 }]) {
    const ctx = await b.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem("sfl_rd_lang", "en"); } catch { /* */ } });
    await p.goto(`http://localhost:${port}/?bk=1&bkmany=1${v.w < 900 ? "&ios=1" : ""}`, { waitUntil: "networkidle" });
    await wait(p, 1500);
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__sflInject()); await wait(p, 150); }
    await wait(p, 500);
    await p.evaluate(() => { const b = [...document.querySelectorAll("[data-testid=basket-badge-btn]")].find((x) => x.textContent === "🛒15"); b.click(); });
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `${v.name}-6-many-top.png`) });
    const m = await p.evaluate(() => { const l = document.querySelector("[data-testid=bk-list]"); const r = document.querySelector("[data-testid=bk-panel]").getBoundingClientRect(); const before = l.scrollTop; l.scrollTop = l.scrollHeight; return `sheet height ${Math.round(r.height)} of ${window.innerHeight} (${Math.round(r.height / window.innerHeight * 100)}%), list ${l.clientHeight}/${l.scrollHeight}px scrolls=${l.scrollHeight > l.clientHeight + 1}, lines=${document.querySelectorAll("[data-testid=bk-line]").length}, scrolled ${before}→${Math.round(l.scrollTop)}, see-all=${/see all/i.test(document.body.textContent)}`; });
    await wait(p, 300);
    await p.screenshot({ path: path.join(OUT, `${v.name}-7-many-end.png`) });
    console.log(`${v.name} many: ${m}`);
    fs.appendFileSync(path.join(__dirname, "measured.txt"), `${v.name} many: ${m}\n`);
    await ctx.close();
  }
  await b.close();
})();
