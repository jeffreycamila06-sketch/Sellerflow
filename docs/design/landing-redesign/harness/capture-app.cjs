// Real product screens for the landing preview — taken from the REAL app in preview mode
// (src/dev/fakeSupabase.ts: in-memory data, made-up buyers; no network, no sign-in).
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/landing-redesign/harness/capture-app.cjs [port]
// Comments are the app's own sample comments (the "+ Test comment" preview button, which sellers never
// see, is hidden before each picture). Orders are made by really tapping Type price / 1-Click.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "..", "preview", "assets");
fs.mkdirSync(OUT, { recursive: true });

async function open(b, { w, h, dark, query = "" }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([d]) => { try { localStorage.setItem("sfl_rd_lang", "en"); localStorage.setItem("sfl_rd_theme", d ? "dark" : "light"); } catch { /* preview */ } }, [dark]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await p.goto(`http://localhost:${port}/${query}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1300);
  return { ctx, p };
}
const hideDev = (p) => p.evaluate(() => { for (const el of document.querySelectorAll("button")) if (/Test comment/.test(el.textContent || "")) el.style.display = "none"; });
const inject = async (p, n) => { for (let i = 0; i < n; i++) { await p.evaluate(() => window.__sflInject()); await p.waitForTimeout(220); } await p.waitForTimeout(500); };
const shot = async (p, name, clip) => { await hideDev(p); await p.screenshot({ path: path.join(OUT, name), ...(clip ? { clip } : {}) }); console.log("saved", name); };
// Type price on the row that holds `text`, then Enter.
async function typePrice(p, text, price, between) {
  const row = p.locator("div", { hasText: text }).filter({ has: p.locator("button", { hasText: /^Type price$/ }) }).last();
  await row.locator("button", { hasText: /^Type price$/ }).click();
  await p.waitForTimeout(350);
  await p.keyboard.type(String(price));
  await p.waitForTimeout(250);
  if (between) await between();
  await p.keyboard.press("Enter");
  await p.waitForTimeout(1300);
}

(async () => {
  const b = await chromium.launch();
  // ── the demo loop: comment → order (phone, light and dark) ──
  for (const dark of [false, true]) {
    const tag = dark ? "-dark" : "";
    const { ctx, p } = await open(b, { w: 390, h: 760, dark });
    await inject(p, 3);
    await typePrice(p, "mine red lipstick", 250);
    await shot(p, `loop-1${tag}.png`);                               // a live with one order so far
    await inject(p, 1);
    await shot(p, `loop-2${tag}.png`);                               // a new comment arrives
    await typePrice(p, "藍色水壺", 280, () => shot(p, `loop-3${tag}.png`));   // the seller types the price
    await shot(p, `loop-4${tag}.png`);                               // it is an order: buyer number, total, Reprint
    // more orders, then the Orders screen
    await inject(p, 2);
    await typePrice(p, "white tee", 390);
    await typePrice(p, "紅色口紅", 320);
    await shot(p, `live-busy${tag}.png`);
    await p.locator("button", { hasText: /^Orders$/ }).last().click();
    await p.waitForTimeout(1100);
    await shot(p, `orders${tag}.png`);
    await ctx.close();
  }
  // ── the same live on a laptop ──
  {
    const { ctx, p } = await open(b, { w: 1280, h: 800, dark: false });
    await inject(p, 4);
    await typePrice(p, "mine red lipstick", 250);
    await typePrice(p, "藍色水壺", 280);
    await inject(p, 2);
    await shot(p, "laptop-live.png");
    await ctx.close();
  }
  // ── the sticker layout screen (what the printer prints) ──
  for (const dark of [false, true]) {
    const { ctx, p } = await open(b, { w: 390, h: 760, dark, query: "?admin=1" });
    await p.locator("button", { hasText: /^Settings$/ }).last().click(); await p.waitForTimeout(500);
    await p.locator("button", { hasText: "General Settings" }).first().click(); await p.waitForTimeout(700);
    if (!(await p.locator("[data-testid=ls-print-pattern]").count())) { await p.locator("[data-testid=ls-header]").click(); await p.waitForTimeout(400); }
    await p.locator("[data-testid=ls-print-pattern]").click(); await p.waitForTimeout(2600);
    // the part every seller sees (the block under it is for admins only)
    await shot(p, `sticker-layout${dark ? "-dark" : ""}.png`, { x: 0, y: 0, width: 390, height: 520 });
    await ctx.close();
  }
  await b.close();
})();
