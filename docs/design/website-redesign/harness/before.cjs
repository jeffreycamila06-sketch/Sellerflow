// Seller Website redesign proposal — TODAY's buyer pages (the real shop app, unchanged), pictured at
// iPhone 390 / Android 412 / laptop 1280. Demo shop "Budgetukay" from the v2 harness: every database
// call is answered with demo data by that harness (no real Supabase, no real buyer).
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/website-redesign/harness/before.cjs [name-prefix]
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, routes, ORDER: ORDER0, NOW } = require("../../seller-website-v2/harness/shoot.cjs");
// the buyer in these pictures is a plain placeholder (no person's name or number, not even a made-up one)
const BUYER = JSON.stringify({ name: "Demo Buyer", phone: "0900 000 000", contact: "", address: "", stores: { s711: [{ id: "123456", name: "板橋門市" }] } });
const ORDER = { ...ORDER0, buyerName: "Demo Buyer", phoneTail: "000" };
const OUT = path.join(__dirname, "..", "before");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/seller-website-v2/harness/index.html?m=shop&path=/s/budgetukay";
const T = "f".repeat(64);
const ONLY = process.argv[2] || "";
// what a website started today gets: Brand store + Ocean (src/website/v3/look.ts NEW_SHOP_LOOK)
const OCEAN = { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" };
const base = shopFor("pop");
const BRAND = { ...base, shop: { ...base.shop, catPics: { Tops: "u1/site-cat-1.jpg", Hoodies: "u1/site-cat-2.jpg" }, look: OCEAN } };
const MARKET = base; // a shop made before the look settings: Marketplace layout, "Pop" theme
const VIEWS = [
  ["iphone390", { ...devices["iPhone 13"], deviceScaleFactor: 2 }],
  ["android412", { ...devices["Pixel 7"], deviceScaleFactor: 2 }],
  ["laptop1280", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 }],
];
const CART = JSON.stringify([{ pid: 4, vid: 305, qty: 1 }, { pid: 2, vid: null, qty: 1 }]);
const SHOTS = [
  ["brand-1-home", "", { shop: BRAND }],
  ["brand-2-product", "/p/1", { shop: BRAND, click: ['[data-testid="pd-opt"]:has-text("Purple")', '[data-testid="pd-opt"] >> text=/^L$/'] }],
  ["brand-3-cart", "/cart", { shop: BRAND, cart: true }],
  ["brand-4-checkout", "/checkout", { shop: BRAND, cart: true, buyer: true }],
  ["brand-5-order", `/o/${T}`, { shop: BRAND }],
  ["market-1-home", "", { shop: MARKET }],
];
(async () => {
  const browser = await chromium.launch();
  const made = [];
  for (const [name, p, o] of SHOTS) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const [vn, dev] of VIEWS) {
      const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
      const page = await ctx.newPage();
      await routes(page, o.shop, ORDER);
      // the shop's real fonts (the v2 harness blocks them; a "today" picture needs them)
      // (FONT_DIR = a folder holding the shop's Google Fonts css as shop-latin.css + its .woff2 files, fetched once)
      if (process.env.FONT_DIR) {
        const dir = process.env.FONT_DIR;
        await page.unroute("**/fonts.googleapis.com/**");
        await page.route("**/fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: fs.readFileSync(path.join(dir, "shop-latin.css"), "utf8") }));
        await page.route("**/fonts.gstatic.com/**", (r) => { const f = path.join(dir, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) }) : r.abort(); });
      }
      await page.addInitScript(([cart, buyer, o2, now]) => {
        const D = Date;
        globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
        localStorage.setItem("sfl_shop_lang", "en");
        if (o2.cart) localStorage.setItem("sfl_shop_cart_budgetukay", cart);
        if (o2.buyer) localStorage.setItem("sfl_shop_buyer", buyer);
      }, [CART, BUYER, { cart: !!o.cart, buyer: !!o.buyer }, NOW]);
      await page.goto(BASE + p, { waitUntil: "networkidle" });
      // shop.html (the live entry page) links the four font families; the harness page does not, so add the same link here
      if (process.env.FONT_DIR) await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=shop-html" });
      await page.waitForTimeout(400); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
      for (const c of o.click || []) { await page.locator(c).first().click(); await page.waitForTimeout(350); }
      const fontsOk = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")).filter((v, i, a) => a.indexOf(v) === i).join("+") || "none");
      // first screen (what the buyer sees before scrolling) + the whole page
      await page.screenshot({ path: path.join(OUT, `${name}_${vn}_first.jpg`), type: "jpeg", quality: 80 });
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const vp = page.viewportSize();
      if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 7000) }); await page.waitForTimeout(250); }
      await page.screenshot({ path: path.join(OUT, `${name}_${vn}_full.jpg`), type: "jpeg", quality: 78 });
      made.push(`${name}_${vn} h=${h} fonts=${fontsOk}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(made.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
