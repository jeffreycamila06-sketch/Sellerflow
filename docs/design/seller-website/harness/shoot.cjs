// Seller Website — screenshots of every Phase 1 screen at iPhone / Android / laptop widths.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/seller-website/harness/shoot.cjs
// The shop's database calls (website_shop / website_order / place order) and the photos are answered
// HERE with demo data — no real Supabase, no real buyer data.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/seller-website/harness/index.html";
const T = "f".repeat(64);

const DESIGN = {
  name: "BudgetUkay", tagline: "Pre-loved & new clothes · Taipei", about: "We sell pre-loved and new clothes, checked one by one. Ships from Taipei every day.",
  announcement: "Free shipping over NT$1,500 · New drops every Friday", live: "Live tonight 8:00 PM on Facebook & TikTok", policy: "Message us within 3 days of pickup if something is wrong.",
  replyTime: "~1 hr", color: "#EE4D2D", logo: "demo/logo.jpg", cover: "demo/cover.jpg",
  socials: { facebook: "budgetukay", instagram: "budgetukay.tw", tiktok: "budgetukay", youtube: "BudgetUkayTV", threads: "budgetukay" },
  chats: { messenger: "budgetukay", line: "@budgetukay", whatsapp: "886912000111", instagram: "budgetukay.tw" },
};
const P = (id, name, price, stock, code, cat, days, extra = {}) => ({ id, name, price, stock, code, category: cat, createdAt: new Date(Date.parse("2026-11-15T08:00:00Z") - days * 86400000).toISOString(), photos: [`demo/p${id}.jpg`, `demo/p${id}b.jpg`], ...extra });
const PRODUCTS = [
  P(1, "Floral midi dress, soft chiffon, lined", 350, 0, "A01", "Dresses", 1, {
    description: "Soft chiffon with a full lining. Length 110 cm. Hand wash cold.",
    groups: [{ name: "Size", values: ["S", "M", "L", "XL"] }, { name: "Color", values: ["Pink", "Blue"] }],
    variants: [
      { id: 11, values: ["S", "Pink"], price: 350, stock: 1, photo: null, code: "A01-S-PINK" }, { id: 12, values: ["M", "Pink"], price: 350, stock: 3, photo: null, code: "A01-M-PINK" },
      { id: 13, values: ["L", "Pink"], price: 350, stock: 0, photo: null, code: "A01-L-PINK" }, { id: 14, values: ["M", "Blue"], price: 380, stock: 2, photo: 1, code: "A01-M-BLUE" },
      { id: 15, values: ["XL", "Pink"], price: 350, stock: 0, photo: null, code: "A01-XL-PINK" }, { id: 16, values: ["XL", "Blue"], price: 350, stock: 0, photo: null, code: "A01-XL-BLUE" },
    ] }),
  P(2, "Linen button shirt, oversized", 280, 9, "A02", "Tops", 3),
  P(3, "Mini shoulder bag, vegan leather", 300, 2, "C03", "Bags", 12),
  P(4, "White leather sneakers", 890, 0, "D04", "Shoes", 30),
  P(5, "Pleated wide-leg pants", 420, 5, "B05", "Bottoms", 20),
  P(6, "Knit cardigan, cropped", 390, 3, "A06", "Tops", 2),
];
const SHOP = { online: true, sub: "budgetukay", shop: DESIGN, country: "TW", powered: true, verified: true, stats: { orders: 12400, products: PRODUCTS.length }, products: PRODUCTS,
  checkout: { ship: { s711: { fee: 60 }, fm: { fee: 60 }, home: { fee: 120 } }, freeOver: 1500, bank: { bankName: "Cathay United Bank (013)", accountName: "BudgetUkay", accountNumber: "0123-4567-8901" }, cod: true, autoCancelHours: 24 } };
const ORDER = { found: true, orderNo: "W-0014", status: "awaiting_payment", paymentIssue: false,
  items: [{ pid: 1, vid: 12, name: "Floral midi dress, soft chiffon, lined", label: "M · Pink", code: "A01-M-PINK", price: 350, qty: 2, photo: "demo/p1.jpg" }, { pid: 2, name: "Linen button shirt, oversized", code: "A02", price: 280, qty: 1, photo: "demo/p2.jpg" }],
  subtotal: 980, shipFee: 60, total: 1040, delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank", buyerName: "Maria Santos", phoneTail: "678", receipt: false,
  createdAt: "2026-11-15T03:00:00Z", autoCancelAt: "2026-11-16T03:00:00Z", shop: { sub: "budgetukay", name: "BudgetUkay", color: "#EE4D2D", chats: DESIGN.chats, currency: "NT$" }, country: "TW",
  pay: { bank: SHOP.checkout.bank } };
const COLORS = ["#F9A8D4", "#93C5FD", "#FCD34D", "#A7F3D0", "#C4B5FD", "#FDBA74", "#FCA5A5"];
function svg(p) {
  const i = [...p].reduce((a, c) => a + c.charCodeAt(0), 0);
  const c = COLORS[i % COLORS.length], c2 = COLORS[(i + 3) % COLORS.length];
  if (p.includes("cover")) return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#EE4D2D"/><stop offset="1" stop-color="#C026D3"/></linearGradient></defs><rect width="1200" height="400" fill="url(#g)"/><g fill="#fff" opacity=".18"><circle cx="200" cy="120" r="90"/><circle cx="980" cy="300" r="140"/><rect x="520" y="60" width="160" height="220" rx="30"/></g></svg>`;
  if (p.includes("logo")) return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#111827"/><text x="100" y="125" font-size="76" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">BU</text></svg>`;
  if (p.includes("receipt")) return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#fff"/><rect x="40" y="40" width="520" height="90" rx="12" fill="#E0E7FF"/><text x="300" y="98" font-size="34" font-family="Arial" text-anchor="middle" fill="#3730A3">Transfer done</text><text x="60" y="220" font-size="28" font-family="Arial" fill="#111827">Amount  NT$1,040</text><text x="60" y="280" font-size="24" font-family="Arial" fill="#6B7280">To  BudgetUkay  ****8901</text><text x="60" y="330" font-size="24" font-family="Arial" fill="#6B7280">2026-11-15 11:08</text></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${c}"/><circle cx="470" cy="120" r="70" fill="${c2}" opacity=".6"/><path d="M220 140h160l60 80-50 30v230H210V250l-50-30z" fill="#fff" opacity=".85"/><path d="M260 140q40 50 80 0" stroke="${c2}" stroke-width="14" fill="none"/></svg>`;
}
async function routes(page, { order = ORDER, closed = false } = {}) {
  await page.route("**/demo.supabase.co/**", async (r) => {
    const u = r.request().url();
    if (u.includes("/storage/v1/object/")) return r.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(u) });
    if (u.includes("/rpc/website_shop")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(closed ? { online: false } : SHOP) });
    if (u.includes("/rpc/website_order")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(order) });
    if (u.includes("/rpc/website_place_order")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, orderNo: "W-0014", token: T, total: 1040 }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
}
const VIEWS = [["iphone", devices["iPhone 13"]], ["android", devices["Pixel 7"]], ["laptop", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }]];
const CART = JSON.stringify([{ pid: 1, vid: 12, qty: 2 }, { pid: 2, vid: null, qty: 1 }]);
const BUYER = JSON.stringify({ name: "Maria Santos", phone: "0912 345 678", contact: "maria.santos", address: "", stores: { s711: [{ id: "123456", name: "Xinyi" }, { id: "234567", name: "Songshan" }] } });
const SHOTS = [
  ["buyer-1-home", "?m=shop&path=/s/budgetukay", {}],
  ["buyer-2-product", "?m=shop&path=/s/budgetukay/p/1", { click: ['[data-testid="pd-opt"] >> text=M', '[data-testid="pd-opt"] >> text=Pink'] }],
  ["buyer-3-cart", "?m=shop&path=/s/budgetukay/cart", { cart: true }],
  ["buyer-4-checkout", "?m=shop&path=/s/budgetukay/checkout", { cart: true, buyer: true }],
  ["buyer-5-store-pick", "?m=shop&path=/s/budgetukay/store", { cart: true, buyer: true }],
  ["buyer-6-order-sent", `?m=shop&path=/s/budgetukay/sent/${T}`, {}],
  ["buyer-7-order-link", `?m=shop&path=/s/budgetukay/o/${T}`, { order: { ...ORDER, status: "payment_sent", receipt: true, receiptAt: "2026-11-15T03:10:00Z" } }],
  ["buyer-8-closed", "?m=shop&path=/s/budgetukay", { closed: true }],
  ["seller-1-website-editor", "?m=editor&plan=pro", {}],
  ["seller-2-editor-free-android-web", "?m=editor&plan=free", {}],
  ["seller-3-editor-free-ios", "?m=editor&plan=free&ios=1", {}],
  ["seller-4-orders-website-tab", "?m=orders", {}],
  ["seller-5-order-detail", "?m=orders", { click: ['[data-testid="wor-row"] >> nth=0', '[data-testid="wor-receipt-open"]'] }],
  ["seller-6-products", "?m=products", { products: true }],
  ["seller-7-product-website-sheet", "?m=products", { products: true, click: ['[data-testid^="prd-web-"] >> nth=0'] }],
  ["seller-8-payment-shipping", "?m=payship", {}],
];
const SELLER_PRODUCTS = JSON.stringify([
  { id: 1, name: "Floral midi dress", sku: "", price: 350, stock: 0, platform: "TikTok / FB", status: "Out of stock", liveCode: "A01", category: "Dresses", variant: { groups: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Pink", "Blue"] }] } },
  { id: 11, name: "Floral midi dress", sku: "", price: 350, stock: 3, platform: "TikTok / FB", status: "Low stock", liveCode: "A01-M-PINK", parentId: 1, variant: { values: ["M", "Pink"] } },
  { id: 12, name: "Floral midi dress", sku: "", price: 380, stock: 2, platform: "TikTok / FB", status: "Low stock", liveCode: "A01-M-BLUE", parentId: 1, variant: { values: ["M", "Blue"], ownPrice: true } },
  { id: 2, name: "Linen button shirt", sku: "", price: 280, stock: 9, platform: "TikTok", status: "Active", liveCode: "A02" },
  { id: 3, name: "Mini shoulder bag", sku: "", price: 300, stock: 2, platform: "TikTok", status: "Low stock", liveCode: "C03", showOnWebsite: false },
]);
(async () => {
  const browser = await chromium.launch();
  const made = [];
  for (const [name, qs, o] of SHOTS) {
    for (const [vn, dev] of VIEWS) {
      const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
      const page = await ctx.newPage();
      await routes(page, { order: o.order || ORDER, closed: !!o.closed });
      await page.addInitScript(([cart, buyer, wantCart, wantBuyer, prods, wantProds]) => {
        localStorage.setItem("sfl_shop_lang", "en");
        if (wantCart) localStorage.setItem("sfl_shop_cart_budgetukay", cart);
        if (wantBuyer) localStorage.setItem("sfl_shop_buyer", buyer);
        if (wantProds) localStorage.setItem("sf_prods", prods);
      }, [CART, BUYER, !!o.cart, !!o.buyer, SELLER_PRODUCTS, !!o.products]);
      // dialogs: a taller phone window so the whole sheet (with its buttons) is in the picture
      if ((name.includes("detail") || name.includes("sheet")) && vn !== "laptop") await page.setViewportSize({ width: page.viewportSize().width, height: 1500 });
      await page.goto(BASE + qs, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      for (const c of o.click || []) { await page.locator(c).first().click(); await page.waitForTimeout(400); }
      const file = path.join(OUT, `${name}_${vn}.jpg`);
      // A fixed bottom bar would land mid-picture in a "fullPage" shot: make the window as tall as
      // the page instead (except for dialogs, which are shown as one phone screen).
      if (!name.includes("detail") && !name.includes("sheet")) {
        const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
        const vp = page.viewportSize();
        if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 9000) }); await page.waitForTimeout(250); }
      }
      await page.screenshot({ path: file, type: "jpeg", quality: 82 });
      made.push(path.basename(file));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${made.length} screenshots in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
