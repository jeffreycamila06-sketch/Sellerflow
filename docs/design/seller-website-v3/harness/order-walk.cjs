// Seller Website v3 — a full order in the Brand store (Ocean) at iPhone width, REAL build:
// home → "+" on a card → size sheet → cart panel → Checkout → Place order → the order page.
// Run: (1) the vite dev server as in compare.cjs; (2) node docs/design/seller-website-v3/harness/order-walk.cjs
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, routes, ORDER, BUYER, NOW } = require("../../seller-website-v2/harness/shoot.cjs");
const OUT = path.join(__dirname, "..", "order-walk");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/seller-website-v2/harness/index.html?m=shop&path=/s/budgetukay";
const OCEAN = { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" };
(async () => {
  const s = shopFor("pop");
  const shop = { ...s, shop: { ...s.shop, catPics: { Tops: "u1/site-cat-1.jpg", Hoodies: "u1/site-cat-2.jpg" }, look: OCEAN } };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "en-US", timezoneId: "Asia/Taipei" });
  const page = await ctx.newPage();
  const placed = [];
  await routes(page, shop, { ...ORDER, items: [{ pid: 3, vid: 202, name: "Straight-leg Denim, mid wash", label: "30", price: 590, qty: 1, photo: "demo/p3.jpg" }], subtotal: 590, shipFee: 60, total: 650 });
  page.on("request", (r) => { if (r.url().includes("/rpc/website_place_order")) placed.push(r.postData()); });
  await page.addInitScript(([buyer, now]) => {
    const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
    localStorage.setItem("sfl_shop_lang", "en");
    localStorage.setItem("sfl_shop_buyer", buyer);
  }, [BUYER, NOW]);
  let i = 0;
  const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, `${++i}-${name}.jpg`), type: "jpeg", quality: 80 }); };
  await page.goto(BASE, { waitUntil: "networkidle" });
  await shot("home");
  const card = page.locator('[data-testid="shop-item"]', { hasText: "Straight-leg Denim" }).first();
  await card.scrollIntoViewIfNeeded();
  await shot("card-with-plus");
  await card.locator('[data-testid="card-quick"]').click();
  await shot("size-sheet");
  await page.locator('[data-testid="brand-size"]', { hasText: /^30$/ }).click();
  await shot("cart-panel");
  await page.locator('[data-testid="panel-checkout"]').click();
  await shot("checkout");
  await page.locator('[data-testid="co-place-phone"]').click();
  await page.waitForTimeout(800);
  await shot("order-page");
  fs.writeFileSync(path.join(OUT, "placed-request.json"), placed[0] || "(no request)");
  console.log(`${i} pictures; place-order request sent: ${placed.length}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
