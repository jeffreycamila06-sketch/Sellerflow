// The REAL app (preview mode, made-up seller) — Invoicing → Format on the TikTok tab ("TikTok invoice format")
// and on the Facebook tab with the Receipt add-on ("Facebook receipt format": opening, payment note, shipping fee,
// payment QR picture, sample). 360 / 390 / 1280 pictures; measured at 360 / 390 / 430 / 1280: nothing wider than
// the screen, the Save / Close / QR buttons ≥ 44 px tall where tapped.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/format-per-tab/shoot.cjs [port]
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
  await p.route("**/fb/access**", (r) => r.fulfill({ json: { ok: true, facebook: true, receipt: true } }));
  await p.route("**/fb/sendall/status**", (r) => r.fulfill({ json: { ok: true, access: true, allowed: true, needsMessaging: false, buyers: [], job: null } }));
  await p.goto(`http://localhost:${port}/?ivc=6,2&fbsa=1&fbfmt=1&admin=1`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => {
      const live = [...document.querySelectorAll("button")].filter((x) => /^Live$/i.test((x.textContent || "").trim()))[0];
      const menu = live ? [...live.parentElement.querySelectorAll("button")] : [];
      menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click();
    }, i);
    await wait(p, 400);
  }
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-format-btn]:not([disabled])");
  return { p, ctx, errs };
}
async function measure(p, sheet) {
  return p.evaluate((sel) => {
    const W = document.documentElement.clientWidth;
    const s = document.querySelector(sel);
    const wide = [...s.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 0.5 || r.left < -0.5); }).length;
    const small = [...s.querySelectorAll("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).map((b) => `${b.textContent.trim()} ${Math.round(b.getBoundingClientRect().height)}px`);
    return { W, pageScroll: document.documentElement.scrollWidth > W, wide, small };
  }, sheet);
}

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [w, h] of [[360, 760], [390, 844], [430, 932], [1280, 860]]) {
    const shoot = w !== 430;
    const { p, ctx, errs } = await open(b, { w, h });
    // TikTok tab
    await tap(p, "[data-testid=ivc-format-btn]"); await p.waitForSelector("[data-testid=ivc-format-sheet]"); await wait(p, 400);
    if (shoot) await p.screenshot({ path: path.join(OUT, `tiktok-${w}.png`) });
    lines.push(`${w} tiktok: title="${await p.textContent("[data-testid=ivc-format-title]")}" ${JSON.stringify(await measure(p, "[data-testid=ivc-format-sheet]"))}`);
    await tap(p, "[data-testid=ivc-format-close]"); await wait(p);
    // Facebook tab
    await tap(p, "[data-testid=ivc-tab-facebook]"); await wait(p, 500);
    await tap(p, "[data-testid=ivc-format-btn]"); await p.waitForSelector("[data-testid=ivc-fbformat-opening]"); await wait(p, 1200);
    if (shoot) await p.screenshot({ path: path.join(OUT, `facebook-${w}-top.png`) });
    lines.push(`${w} facebook: title="${await p.textContent("[data-testid=ivc-fbformat-title]")}" sample=${await p.locator("[data-testid=ivc-fbformat-sample]").count()} ${JSON.stringify(await measure(p, "[data-testid=ivc-fbformat-sheet]"))}`);
    await p.evaluate(() => document.querySelector("[data-testid=ivc-fbformat-qr-row]").scrollIntoView({ block: "start" }));
    await wait(p, 300);
    if (shoot) await p.screenshot({ path: path.join(OUT, `facebook-${w}-qr.png`) });
    await p.evaluate(() => document.querySelector("[data-testid=ivc-fbformat-sample]").scrollIntoView({ block: "end" }));
    await wait(p, 300);
    if (shoot) await p.screenshot({ path: path.join(OUT, `facebook-${w}-sample.png`) });
    if (errs.length) lines.push(`${w} page errors: ${errs.join(" | ")}`);
    await ctx.close();
  }
  // one dark picture of the Facebook sheet (phone)
  {
    const { p, ctx } = await open(b, { w: 390, h: 844, theme: "dark" });
    await tap(p, "[data-testid=ivc-tab-facebook]"); await wait(p, 500);
    await tap(p, "[data-testid=ivc-format-btn]"); await p.waitForSelector("[data-testid=ivc-fbformat-opening]"); await wait(p, 1200);
    await p.screenshot({ path: path.join(OUT, "facebook-390-dark.png") });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
