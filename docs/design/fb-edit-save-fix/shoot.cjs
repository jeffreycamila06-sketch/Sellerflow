// The REAL app (preview mode, made-up seller and buyers) for the Facebook receipt editor save fix:
//   normal sheet (Save off → a change → Save → ✓ Saved), the close question (Save / Discard), and a buyer whose
//   Messenger send failed ("I sent it by hand" + its line). iPhone 390 and laptop 1280, light.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/fb-edit-save-fix/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const LIST = [{ n: 1, tag: "sent", at: "2026-11-26T09:04:00.000Z" }, { n: 2, tag: "not_sent" }, { n: 3, tag: "not_sent" }, { n: 4, tag: "other_app" }, { n: 5, tag: "cant_message" }, { n: 6, tag: "not_sent" }];
async function open(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem("sfl_rd_theme", "light"); localStorage.setItem("sfl_rd_lang", "en"); } catch { /* nothing */ } window.open = () => null; });
  await p.route("**/fb/access**", (r) => r.fulfill({ json: { ok: true, facebook: true, receipt: true } }));
  await p.route("**/fb/sendall/status**", (r) => r.fulfill({ json: { ok: true, access: true, allowed: true, needsMessaging: false, buyers: LIST, job: null } }));
  await p.route("**/fb/sendall/preview**", (r) => r.fulfill({ json: { ok: false } }));
  await p.goto(`http://localhost:${port}/?ivc=0,0&fbsa=1&admin=1`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => { const live = [...document.querySelectorAll("button")].filter((x) => /^(Live)$/i.test((x.textContent || "").trim()))[0]; const menu = live ? [...live.parentElement.querySelectorAll("button")] : []; menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click(); }, i);
    await wait(p, 400);
  }
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-tab-facebook]");
  await tap(p, "[data-testid=ivc-tab-facebook]");
  await p.waitForSelector("[data-testid=ivc-fb-list]");
  await wait(p, 500);
  return { p, errs, ctx };
}
const footer = (p) => p.evaluate(() => { const s = document.querySelector("[data-testid=ivc-fb-sheet-scroll]"); if (s) s.scrollTop = s.scrollHeight; });
const measure = (p) => p.evaluate(() => {
  const wide = document.documentElement.scrollWidth > window.innerWidth;
  const small = [...document.querySelectorAll("[data-testid=ivc-fb-sheet] button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44 && !b.closest("[data-testid=ivc-fb-editor]")).map((b) => b.getAttribute("data-testid"));
  return { wide, small };
});
(async () => {
  const b = await chromium.launch();
  const notes = [];
  for (const [w, h, tag] of [[390, 844, "390"], [1280, 900, "1280"]]) {
    const { p, errs, ctx } = await open(b, w, h);
    await p.click("[data-testid=ivc-fb-row][data-buyer='2'] [data-testid=ivc-fb-row-view]");
    await p.waitForSelector("[data-testid=ivc-fb-editor]"); await wait(p, 600); await footer(p);
    await p.screenshot({ path: path.join(OUT, `normal-${tag}.png`) });
    const pr = p.locator("[data-testid=ivc-fb-sheet] [data-testid=rs-price]").first();
    await pr.click(); await pr.press("End"); await p.keyboard.press("Backspace"); await p.keyboard.type("5");
    await footer(p); await p.screenshot({ path: path.join(OUT, `changed-${tag}.png`) });
    await tap(p, "[data-testid=ivc-fb-save]"); await wait(p, 500); await footer(p);
    await p.screenshot({ path: path.join(OUT, `saved-${tag}.png`) });
    await p.keyboard.press("Backspace"); await p.keyboard.type("0");
    await tap(p, "[data-testid=ivc-fb-sheet-close]"); await wait(p, 300);
    await p.screenshot({ path: path.join(OUT, `close-ask-${tag}.png`) });
    notes.push(`${tag} close-ask: ${JSON.stringify(await measure(p))}`);
    await tap(p, "[data-testid=ivc-fb-close-discard]"); await wait(p, 300);
    await p.click("[data-testid=ivc-fb-row][data-buyer='4'] [data-testid=ivc-fb-row-view]");
    await p.waitForSelector("[data-testid=ivc-fb-editor]"); await wait(p, 600); await footer(p);
    await p.screenshot({ path: path.join(OUT, `failed-send-${tag}.png`) });
    notes.push(`${tag} failed-send: ${JSON.stringify(await measure(p))} hand=${!!(await p.$("[data-testid=ivc-fb-sheet-hand]"))}`);
    notes.push(`${tag} page errors: ${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), notes.join("\n") + "\n");
  console.log(notes.join("\n"));
  await b.close();
})();
