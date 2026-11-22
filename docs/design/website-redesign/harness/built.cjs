// Seller Website v4 — pictures of the REAL build (the shop app itself, not the mock), new look ON and OFF.
// The shop's database calls are answered here with demo data (the v2 harness); the new-look question
// (rpc website_new_look, sql/203) is answered true / false per picture. Buyer = the placeholder "Demo Buyer".
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) FONT_DIR=<folder> node docs/design/website-redesign/harness/built.cjs [name-prefix]
//   FONT_DIR: Google Fonts css saved as latin.css (+ shop-latin.css for the older looks) and the .woff2 files —
//   the test browser has no internet. Without it the pictures use the fallback fonts.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { shopFor, routes, ORDER: ORDER0, NOW } = require("../../seller-website-v2/harness/shoot.cjs");
const OUT = path.join(__dirname, "..", "built");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/seller-website-v2/harness/index.html?m=shop&path=/s/budgetukay";
const T = "f".repeat(64);
const ONLY = process.argv[2] || "";
const BUYER = JSON.stringify({ name: "Demo Buyer", phone: "0900 000 000", contact: "", address: "", stores: { s711: [{ id: "123456", name: "板橋門市" }] } });

// stand-in photos: the drawings of the proposal's mock (after/mock-art.js), by product kind
const win = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "after", "mock-art.js"), "utf8"), { window: win, encodeURIComponent });
const data = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "after", "mock-data.js"), "utf8"), { window: data });
const svgOf = (uri) => decodeURIComponent(uri.slice(uri.indexOf(",") + 1));

// shop 1: clothes — the v2 harness demo shop, with the seller's settings it has today ("Ocean")
const OCEAN = { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" };
const base = shopFor("pop");
const KIND1 = { 1: ["tee", "#e7e1d8", "#7a5fb8"], 2: ["jacket", "#e6dad0", "#7b6a4d"], 3: ["jeans", "#ecebe6", "#4d6a94"], 4: ["hoodie", "#d9dfd4", "#c9a23a"], 5: ["dress", "#e8dcdc", "#b76a79"], 6: ["skirt", "#e8dcdc", "#4b4a55"], 7: ["cap", "#dde1e4", "#3f5b78"], 8: ["tote", "#ecebe6", "#b8a887"], 9: ["sneaker", "#dde1e4", "#c9c4b8"], 10: ["shirt", "#e7e1d8", "#a3493f"], 11: ["hoodie", "#e6dad0", "#2f3a46"], 12: ["jacket", "#dde1e4", "#3f5f8c"] };
const CLOTHES = { ...base, shop: { ...base.shop, announcement: "Free shipping over NT$1,500 · New drop every Friday 8PM", catPics: { Tops: "cat/1", Jackets: "cat/2", Bottoms: "cat/3", Hoodies: "cat/4", Dresses: "cat/5" }, look: OCEAN } };
const CAT1 = { 1: KIND1[1], 2: KIND1[2], 3: KIND1[3], 4: KIND1[4], 5: KIND1[5] };
// shop 2: food — built from the proposal's "Sunday Oven", square photos, friendly font, round corners
const S = data.SHOPS.sundayoven;
const P2 = S.products.map((p, i) => ({ id: p.id, name: p.name, price: p.old || p.price, stock: p.left || 14, category: ["Bread & pastries", "Bread & pastries", "Pantry jars", "Pantry jars", "Bread & pastries", "Gift boxes", "Pantry jars", "Coffee"][i], createdAt: new Date(NOW - (p.isNew ? 2 : 30 + i) * 86400000).toISOString(),
  photos: [`food/${p.id}`, `food/${p.id}b`, `food/${p.id}c`], sold: p.sold, condition: p.meta, ...(p.old ? { oldPrice: p.old, flashPrice: p.price, flashEnd: new Date(NOW + 5.5 * 3600000).toISOString() } : {}),
  ...(p.id === 1 ? { description: S.detail.text, sizeGuide: "Wheat, milk, egg, cheese.", groups: [{ name: "Box", values: ["6 pieces", "12 pieces"] }], variants: [{ id: 101, values: ["6 pieces"], price: 220, stock: 14, photo: null }, { id: 102, values: ["12 pieces"], price: 420, stock: 6, photo: null }] } : {}) }));
const FOOD = { ...base, stats: { orders: 1208, products: P2.length }, products: P2,
  shop: { name: S.name, tagline: S.tagline, about: S.about, announcement: S.announcement, live: `${S.live.when} ${S.live.where}`, policy: "Send a photo in chat within 24 hours if something arrives wrong. We replace or refund.", replyTime: "about an hour",
    socials: { facebook: "sundayoven", instagram: "sundayoven" }, chats: { line: "@sundayoven", messenger: "sundayoven" }, slides: [{ title: S.slide.title, text: S.slide.text }],
    promo: { title: S.promo.title, text: S.promo.text, button: S.promo.button }, faq: [{ q: "How long does it keep?", a: "3 days at room temperature, 2 weeks frozen." }, { q: "Do you ship chilled?", a: "Yes, home delivery is chilled." }],
    catPics: { "Bread & pastries": "fcat/1", "Pantry jars": "fcat/3", "Gift boxes": "fcat/6", Coffee: "fcat/8" }, look: { ...S.look, layout: "brand", shape: "square" } } };
function svg(url) {
  const m = /\/product-images\/(.+?)(?:\?|$)/.exec(url); const p = m ? m[1] : "";
  const view = /b(-s)?(\.jpg)?$/.test(p) ? 1 : /c(-s)?(\.jpg)?$/.test(p) ? 2 : 0;
  let k;
  if (p.startsWith("food/") || p.startsWith("fcat/")) { const x = S.products.find((q) => q.id === parseInt(p.split("/")[1], 10)); k = x ? [x.kind, x.ground, x.col] : ["box", "#ead9c6", "#7b4fa0"]; }
  else if (p.startsWith("cat/")) k = CAT1[parseInt(p.split("/")[1], 10)];
  else { const id = parseInt((/p(\d+)/.exec(p) || [])[1], 10); k = KIND1[id]; }
  if (!k) return null;
  return svgOf(win.ART.photo(k[0], k[1], k[2], p.startsWith("cat/") || p.startsWith("fcat/") ? 0 : view));
}
const order = (shop, items, total) => ({ ...ORDER0, buyerName: "Demo Buyer", phoneTail: "000", items, subtotal: total - 60, shipFee: 60, total, shop: { ...ORDER0.shop, name: shop.shop.name, chats: shop.shop.chats } });
const SHOPS = {
  clothes: { shop: CLOTHES, cart: [{ pid: 4, vid: 305, qty: 1 }, { pid: 2, vid: null, qty: 1 }], product: "/p/1", click: ['[data-testid="pd-opt"]:has-text("Purple")', '[data-testid="pd-opt"] >> text=/^L$/'], order: order(CLOTHES, ORDER0.items, 1430) },
  food: { shop: FOOD, cart: [{ pid: 1, vid: 101, qty: 2 }, { pid: 3, vid: null, qty: 1 }], product: "/p/1", click: ['[data-testid="pd-opt"]:has-text("6 pieces")'],
    order: order(FOOD, [{ pid: 1, vid: 101, name: P2[0].name, label: "6 pieces", price: 220, qty: 2, photo: "food/1" }, { pid: 3, name: P2[2].name, price: 180, qty: 1, photo: "food/3" }], 680) },
};
const VIEWS = [["iphone390", { ...devices["iPhone 13"], deviceScaleFactor: 2 }], ["android412", { ...devices["Pixel 7"], deviceScaleFactor: 2 }], ["laptop1280", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 }]];
const PAGES = [["1-home", "", {}], ["2-product", null, {}], ["3-cart", "/cart", { cart: true }], ["4-checkout", "/checkout", { cart: true, buyer: true }], ["5-order", `/o/${T}`, {}]];
const SHOTS = [];
for (const look of ["new", "old"]) for (const sk of Object.keys(SHOPS)) for (const [pn, p, o] of PAGES) {
  if (look === "old" && sk !== "clothes") continue; // the old look is pictured for one shop (it is today's look)
  SHOTS.push([`${look}-${sk}-${pn}`, look === "new", sk, p === null ? SHOPS[sk].product : p, { ...o, click: p === null ? SHOPS[sk].click : undefined }]);
}
async function open(browser, dev, on, sk, p, o) {
  const s = SHOPS[sk]; const dir = process.env.FONT_DIR;
  const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
  const page = await ctx.newPage();
  await routes(page, s.shop, s.order);
  await page.route("**/demo.supabase.co/storage/v1/object/**", (r) => { const b = svg(r.request().url()); return b ? r.fulfill({ status: 200, contentType: "image/svg+xml", body: b }) : r.fallback(); });
  await page.route("**/rpc/website_new_look", (r) => r.fulfill({ status: 200, contentType: "application/json", body: String(on) }));
  if (dir) {
    await page.unroute("**/fonts.googleapis.com/**");
    await page.route("**/fonts.googleapis.com/**", (r) => { const u = r.request().url(); const f = /Archivo|Bricolage|Newsreader|Figtree/.test(u) && !/Space\+Grotesk|Jakarta/.test(u) ? "latin.css" : "shop-latin.css"; return r.fulfill({ status: 200, contentType: "text/css", body: fs.readFileSync(path.join(dir, f), "utf8") }); });
    await page.route("**/fonts.gstatic.com/**", (r) => { const f = path.join(dir, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) }) : r.abort(); });
  }
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.addInitScript(([cart, buyer, o2, now]) => {
    const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
    localStorage.setItem("sfl_shop_lang", "en");
    if (o2.cart) localStorage.setItem("sfl_shop_cart_budgetukay", cart);
    if (o2.buyer) localStorage.setItem("sfl_shop_buyer", buyer);
  }, [JSON.stringify(s.cart), BUYER, { cart: !!o.cart, buyer: !!o.buyer }, NOW]);
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  if (dir && !on) await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Space+Grotesk" }); // shop.html's own font link (the harness page has none)
  await page.waitForTimeout(400); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
  for (const c of o.click || []) { await page.locator(c).first().click(); await page.waitForTimeout(300); }
  return { ctx, page, errs };
}
module.exports = { open, SHOPS, VIEWS, T };
if (require.main === module) (async () => {
  const browser = await chromium.launch(); const made = [];
  for (const [name, on, sk, p, o] of SHOTS) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const [vn, dev] of VIEWS) {
      const { ctx, page, errs } = await open(browser, dev, on, sk, p, o);
      const info = await page.evaluate(() => ({ key: document.querySelector('[data-testid="shop-root"]')?.getAttribute("data-theme-key"), fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")).filter((v, i, a) => a.indexOf(v) === i).join("+") || "none", over: document.documentElement.scrollWidth - innerWidth }));
      await page.screenshot({ path: path.join(OUT, `${name}_${vn}_first.jpg`), type: "jpeg", quality: 80 });
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const vp = page.viewportSize();
      if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 7000) }); await page.waitForTimeout(250); }
      await page.screenshot({ path: path.join(OUT, `${name}_${vn}_full.jpg`), type: "jpeg", quality: 78 });
      made.push(`${name}_${vn} look=${info.key} h=${h} fonts=${info.fonts} sideways=${info.over}${errs.length ? " ERR " + errs[0] : ""}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(made.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
