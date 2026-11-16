// Seller Website v2 — screenshots of every buyer page in the REAL build, 3 themes × iPhone / Android /
// laptop, plus the seller screens, plus a Canada and an Australia checkout walk-through.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/seller-website-v2/harness/shoot.cjs [only-name-prefix]
// The shop's database calls are answered HERE with demo data — no real Supabase, no real buyer data.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/seller-website-v2/harness/index.html";
const T = "f".repeat(64);
const ONLY = process.argv[2] || "";
const NOW = Date.parse("2026-11-16T08:00:00Z");
const hours = (h) => new Date(NOW + h * 3600000).toISOString();

const DESIGN = {
  name: "Budgetukay", tagline: "Hand-picked Japan & Korea ukay · Banqiao, Taiwan",
  about: "We started live-selling ukay in Taiwan 8 years ago. Every Friday we open new bales live — the best pieces land here. Washed, measured, honestly graded.",
  announcement: "🚚 Free shipping over NT$1,500 · New drop every Friday 8PM", live: "Friday 8:00 PM on TikTok & Facebook",
  policy: "Within 7 days of pickup, if the item is not as described. Send a photo in chat. We refund or exchange.",
  replyTime: "a few minutes", logo: "demo/logo.jpg", cover: "demo/cover.jpg",
  socials: { facebook: "budgetukay", instagram: "budgetukay.tw", tiktok: "budgetukay", youtube: "BudgetUkayTV" },
  chats: { line: "@budgetukay", messenger: "budgetukay", whatsapp: "886912000111", instagram: "budgetukay.tw" },
  slides: [
    { title: "Friday Drop: 60 new pieces", text: "Hand-picked from Japan & Korea. One of each — when it's gone, it's gone.", button: "Shop the drop", pic: "u1/site-slide-1.jpg" },
    { title: "Hoodie season", text: "Oversized, heavyweight, from NT$480.", button: "See hoodies", cat: "Hoodies", pic: "u1/site-slide-2.jpg" },
    { title: "New arrivals every week", text: "Washed, measured, honestly graded.", button: "See what's new", pic: "u1/site-slide-3.jpg" },
  ],
  promo: { title: "Bundle any 3 tops — save NT$150", text: "Perfect for gifting. Mix sizes and colours.", button: "Shop tops", cat: "Tops" },
  faq: [{ q: "How long is shipping?", a: "Orders are packed within 1–2 days. Store pickup arrives in 2–3 days, home delivery in 1–2 days." }, { q: "How are items graded?", a: "10/10 is brand new. 9/10 is like new. 8/10 has light wear that we always show in the photos." }],
};
const COLOR = { name: "Color", values: ["Purple", "Black", "Cream"], color: true, swatches: { Purple: "#7C3AED", Black: "#1F2937", Cream: "#E7DCC6" } };
const P = (id, name, price, stock, cat, days, extra = {}) => ({ id, name, price, stock, category: cat, createdAt: new Date(NOW - days * 86400000).toISOString(), photos: [`demo/p${id}.jpg`, `demo/p${id}b.jpg`, `demo/p${id}c.jpg`], ...extra });
const sizes = (base, list, colorVals) => {
  const out = []; let id = base;
  for (const c of colorVals || [null]) for (const [s, n] of list) out.push({ id: ++id, values: c ? [c, s] : [s], price: undefined, stock: n, photo: null });
  return out;
};
const withVariants = (p, groups, vs) => ({ ...p, groups, variants: vs.map((v) => ({ ...v, price: v.price ?? p.price })) });
const PRODUCTS = [
  withVariants(P(1, "Vintage Sport Tee — Japan pick", 280, 0, "Tops", 9, { oldPrice: 400, flashPrice: 249, flashEnd: hours(2.24), sold: 134, condition: "9/10 — like new", sizeGuide: "M · chest 52 cm · length 68 cm\nL · chest 56 cm · length 70 cm\nXL · chest 60 cm · length 73 cm", description: "Soft, broken-in feel with no stains or holes. Model is 165 cm wearing size M." }),
    [COLOR, { name: "Size", values: ["M", "L", "XL"] }], sizes(100, [["M", 2], ["L", 3], ["XL", 0]], ["Purple", "Black", "Cream"])),
  P(2, "Workwear Chore Jacket (1 of 1)", 890, 1, "Jackets", 1, { condition: "8.5/10 — light fade on cuffs" }),
  withVariants(P(3, "Straight-leg Denim, mid wash", 650, 0, "Bottoms", 15, { oldPrice: 850, flashPrice: 590, flashEnd: hours(2.24), sold: 88, condition: "9/10" }), [{ name: "Size", values: ["28", "30", "32", "34"] }], sizes(200, [["28", 1], ["30", 2], ["32", 2], ["34", 0]])),
  withVariants(P(4, "Korean Oversized Hoodie", 480, 0, "Hoodies", 20, { sold: 212, condition: "Brand new overrun" }), [{ ...COLOR, values: ["Mustard", "Sage", "Charcoal"], swatches: { Mustard: "#CA8A04", Sage: "#6B8F71", Charcoal: "#374151" } }, { name: "Size", values: ["M", "L", "XL"] }], sizes(300, [["M", 4], ["L", 5], ["XL", 2]], ["Mustard", "Sage", "Charcoal"])),
  withVariants(P(5, "Floral Midi Dress", 390, 0, "Dresses", 2, { sold: 57, condition: "9.5/10" }), [{ name: "Size", values: ["S", "M", "L"] }], sizes(400, [["S", 2], ["M", 2], ["L", 1]])),
  P(6, "Y2K Pleated Mini Skirt", 250, 5, "Bottoms", 25, { oldPrice: 320, sold: 73 }),
  P(7, "Washed Dad Cap", 150, 9, "Bags & Caps", 30, { sold: 164 }),
  P(8, "Heavy Canvas Tote", 199, 6, "Bags & Caps", 40, { sold: 96 }),
  P(9, "Retro Runner Sneakers", 780, 0, "Shoes", 50, { sold: 31 }),
  P(10, "Soft Flannel Check Shirt", 320, 5, "Tops", 3, { sold: 49 }),
  P(11, "Heavyweight Logo Hoodie", 560, 2, "Hoodies", 60, { oldPrice: 720, flashPrice: 499, flashEnd: hours(2.24), sold: 40 }),
  P(12, "Classic Denim Trucker Jacket", 720, 2, "Jackets", 4, { sold: 22 }),
];
const CK_TW = { ship: { s711: { fee: 60 }, fm: { fee: 60 }, home: { fee: 120 } }, freeOver: 1500, bank: { bankName: "822 CTBC", accountName: "Budgetukay", accountNumber: "1234-5678-9012" }, cod: true, autoCancelHours: 24 };
const CK2 = {
  TW: { options: [{ id: "s711", needs: "store711", fee: 60, freeOver: 1500, cod: true, note: "Pick up at any 7-11 · 2–3 days" }, { id: "fm", needs: "storefm", fee: 60, freeOver: 1500, cod: true, note: "Pick up at any FamilyMart · 2–3 days" }, { id: "home", needs: "address", fee: 120, freeOver: 1500, cod: false, note: "Delivered to your address · 1–2 days" }],
    methods: [{ id: "bank", kind: "first", bank: CK_TW.bank }, { id: "qr", kind: "first", name: "LINE Pay", qr: "u1/site-qr-1.jpg" }, { id: "cod", kind: "delivery" }], autoCancelHours: 24 },
  CA: { options: [{ id: "std", needs: "address", fee: 15, freeOver: 150, cod: false, note: "Canada Post · 3–5 days" }, { id: "exp", needs: "address", fee: 25, cod: false, note: "1–2 days" }, { id: "pickup", needs: "none", fee: 0, cod: true, note: "Toronto, Sat 2–5pm" }],
    methods: [{ id: "interac", kind: "first", info: "Send an Interac e-Transfer to pay@budgetukay.ca — use your W number as the message." }, { id: "pod", kind: "delivery" }], autoCancelHours: 24, taxIncluded: true },
  AU: { options: [{ id: "std", needs: "address", fee: 12, freeOver: 120, cod: false, note: "Australia Post · 3–6 days" }, { id: "pickup", needs: "none", fee: 0, cod: true, note: "Sydney CBD" }],
    methods: [{ id: "payid", kind: "first", info: "PayID: 0412 345 678 (Budgetukay)" }, { id: "bank", kind: "first", bank: { bankName: "CommBank", accountName: "Budgetukay", accountNumber: "BSB 062-000 · 1234 5678" } }], autoCancelHours: 24, taxIncluded: true },
};
const shopFor = (theme, country = "TW", extra = {}) => ({ online: true, sub: "budgetukay", country, powered: true, verified: true, stats: { orders: 632, products: PRODUCTS.length },
  shop: { ...DESIGN, theme, ...(country === "TW" ? {} : { announcement: undefined }), ...extra }, products: PRODUCTS, checkout: country === "TW" ? CK_TW : { ship: {}, autoCancelHours: 24 }, checkout2: CK2[country] });
const ORDER = { found: true, orderNo: "W-1042", status: "awaiting_payment", paymentIssue: false,
  items: [{ pid: 4, vid: 305, name: "Korean Oversized Hoodie", label: "Sage · L", price: 480, qty: 1, photo: "demo/p4.jpg" }, { pid: 2, name: "Workwear Chore Jacket (1 of 1)", price: 890, qty: 1, photo: "demo/p2.jpg" }],
  subtotal: 1370, shipFee: 60, total: 1430, delivery: "s711", storeId: "123456", storeName: "板橋門市", payment: "bank", buyerName: "Maria Santos", phoneTail: "678", receipt: false,
  createdAt: hours(-0.1), autoCancelAt: hours(23.9), shop: { sub: "budgetukay", name: "Budgetukay", chats: DESIGN.chats, currency: "NT$" }, country: "TW", shipId: "s711", payId: "bank",
  pay: { method: { id: "bank", kind: "first", bank: CK_TW.bank } } };
const COLORS = ["#E9D5FF", "#FDE68A", "#BFDBFE", "#C7D2FE", "#FECDD3", "#BBF7D0", "#FED7AA", "#DBEAFE", "#FEF9C3"];
function svg(p) {
  const i = [...p].reduce((a, c) => a + c.charCodeAt(0), 0);
  const c = COLORS[i % COLORS.length], c2 = COLORS[(i + 4) % COLORS.length];
  if (p.includes("site-slide")) return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff7a45"/><stop offset=".6" stop-color="#ee4d2d"/><stop offset="1" stop-color="#c81e4a"/></linearGradient></defs><rect width="1200" height="600" fill="url(#g)"/><g fill="#fff" opacity=".16"><circle cx="980" cy="160" r="150"/><circle cx="820" cy="470" r="90"/></g><path d="M860 170 940 130q40 50 80 0l80 40 90 80-60 60-40-30v230H900V320l-40 30-60-60z" fill="#fde68a" opacity=".95"/></svg>`;
  if (p.includes("cover")) return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="#c8a98a"/></svg>`;
  if (p.includes("logo")) return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ee4d2d"/><text x="100" y="128" font-size="90" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">B</text></svg>`;
  if (p.includes("site-qr")) return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><g fill="#111">${Array.from({ length: 100 }, (_, k) => ((k * 7919) % 3 ? `<rect x="${(k % 10) * 26 + 20}" y="${Math.floor(k / 10) * 26 + 20}" width="22" height="22"/>` : "")).join("")}</g></svg>`;
  const v = p.includes("b.jpg") ? 1 : p.includes("c.jpg") ? 2 : 0;
  const tr = ["", "translate(-180 -120) scale(1.6)", "translate(70 70) scale(.75) rotate(-7 300 300)"][v];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="672" viewBox="0 0 600 672"><rect width="600" height="672" fill="${c}"/><ellipse cx="300" cy="610" rx="170" ry="16" fill="rgba(0,0,0,.08)"/><g transform="${tr}"><path d="M180 140 252 100Q300 150 348 100L420 140 510 220 450 290 408 255V560H192V255L150 290 90 220Z" fill="${c2}" stroke="rgba(0,0,0,.12)" stroke-width="3"/></g></svg>`;
}
async function routes(page, shop, order) {
  await page.route("**/demo.supabase.co/**", async (r) => {
    const u = r.request().url();
    if (u.includes("/storage/v1/object/")) return r.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(u) });
    if (u.includes("/rpc/website_shop")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shop) });
    if (u.includes("/rpc/website_order")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(order) });
    if (u.includes("/rpc/website_place_order")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, orderNo: "W-1042", token: T, total: 1430 }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
}
const VIEWS = [["iphone", devices["iPhone 13"]], ["android", devices["Pixel 7"]], ["laptop", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }]];
const CART = JSON.stringify([{ pid: 4, vid: 305, qty: 1 }, { pid: 2, vid: null, qty: 1 }]);
const BUYER = JSON.stringify({ name: "Maria Santos", phone: "0912 345 678", contact: "maria.santos", address: "", stores: { s711: [{ id: "123456", name: "板橋門市" }] } });
const BUYER_CA = JSON.stringify({ name: "Ann Lee", phone: "416 555 0199", contact: "", address: "", addr: { street: "12 King St W", city: "Toronto", region: "ON", post: "M5H 2N2" }, stores: {} });
const BUYER_AU = JSON.stringify({ name: "Sam Taylor", phone: "0412 345 678", contact: "", address: "", addr: { street: "1 George St", city: "Sydney", region: "NSW", post: "2000" }, stores: {} });
const SAVED = JSON.stringify([5, 11]);
const PAGES = [
  ["1-home", "", {}],
  ["2-shop", "/shop", {}],
  ["3-product", "/p/1", { click: ['[data-testid="pd-opt"] >> text=Purple', '[data-testid="pd-opt"] >> text=L'] }],
  ["4-cart", "/cart", { cart: true }],
  ["5-checkout", "/checkout", { cart: true, buyer: true }],
  ["6-order", `/o/${T}`, {}],
  ["7-saved", "/saved", { saved: true }],
  ["8-orders", "/orders", { orders: true }],
];
const THEMES = ["pop", "boutique", "bold"];
const SHOTS = [];
for (const th of THEMES) for (const [n, p, o] of PAGES) SHOTS.push([`buyer-${th}-${n}`, `?m=shop&path=/s/budgetukay${p}`, { ...o, shop: shopFor(th) }]);
// Canada + Australia: the checkout walk-through (empty → filled → order link)
for (const c of ["CA", "AU"]) {
  const buyer = c === "CA" ? BUYER_CA : BUYER_AU;
  SHOTS.push([`walk-${c}-1-cart`, "?m=shop&path=/s/budgetukay/cart", { cart: true, shop: shopFor("pop", c) }]);
  SHOTS.push([`walk-${c}-2-checkout-empty`, "?m=shop&path=/s/budgetukay/checkout", { cart: true, shop: shopFor("pop", c), place: true }]);
  SHOTS.push([`walk-${c}-3-checkout-filled`, "?m=shop&path=/s/budgetukay/checkout", { cart: true, buyerJson: buyer, shop: shopFor("pop", c) }]);
  SHOTS.push([`walk-${c}-4-order-link`, `?m=shop&path=/s/budgetukay/o/${T}`, { shop: shopFor("pop", c), order: { ...ORDER, delivery: "home", storeId: undefined, storeName: undefined, address: c === "CA" ? "12 King St W, Toronto, ON M5H 2N2" : "1 George St, Sydney NSW 2000", shipId: "std", payId: c === "CA" ? "interac" : "payid", payment: "bank", country: c, shop: { ...ORDER.shop, currency: c === "CA" ? "CA$" : "A$" }, shipFee: c === "CA" ? 15 : 12, total: 1370 + (c === "CA" ? 15 : 12), pay: { method: CK2[c].methods[0] } } }]);
}
SHOTS.push(["seller-1-website-editor", "?m=editor&plan=pro", {}]);
SHOTS.push(["seller-2-payment-shipping-TW", "?m=payship&country=TW", {}]);
SHOTS.push(["seller-3-payment-shipping-CA", "?m=payship&country=CA", {}]);
SHOTS.push(["seller-4-order-ship-form", "?m=orders", { click: ['[data-testid="wor-f-all"]', '[data-testid="wor-row"] >> nth=2', '[data-testid="wor-act-shipped"]'] }]);

(async () => {
  const browser = await chromium.launch();
  const made = [];
  for (const [name, qs, o] of SHOTS) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const [vn, dev] of VIEWS) {
      if (name.startsWith("walk-") && vn === "android") continue;
      const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
      const page = await ctx.newPage();
      await routes(page, o.shop || shopFor("pop"), o.order || ORDER);
      await page.addInitScript(([cart, buyer, saved, o2, now]) => {
        const D = Date; const fixed = now;
        // the page's clock = the demo's (flash countdowns, "new" badges)
        globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
        localStorage.setItem("sfl_shop_lang", "en");
        if (o2.cart) localStorage.setItem("sfl_shop_cart_budgetukay", cart);
        if (o2.buyer) localStorage.setItem("sfl_shop_buyer", buyer);
        if (o2.buyerJson) localStorage.setItem("sfl_shop_buyer", o2.buyerJson);
        if (o2.saved) localStorage.setItem("sfl_shop_saved_budgetukay", saved);
        if (o2.orders) localStorage.setItem("sfl_shop_orders_budgetukay", JSON.stringify([{ token: "f".repeat(64), no: "W-1042", at: new D(fixed).toISOString(), total: 1430 }, { token: "e".repeat(64), no: "W-1037", at: new D(fixed - 5 * 86400000).toISOString(), total: 640 }]));
      }, [CART, BUYER, SAVED, { cart: !!o.cart, buyer: !!o.buyer, buyerJson: o.buyerJson || "", saved: !!o.saved, orders: !!o.orders }, NOW]);
      await page.goto(BASE + qs, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      for (const c of o.click || []) { await page.locator(c).first().click(); await page.waitForTimeout(350); }
      if (o.place) { const b = page.locator(vn === "laptop" ? '[data-testid="co-place"]' : '[data-testid="co-place-phone"]'); if (await b.count()) { await b.first().click(); await page.waitForTimeout(300); } }
      const file = path.join(OUT, `${name}_${vn}.jpg`);
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const vp = page.viewportSize();
      if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 9000) }); await page.waitForTimeout(250); }
      await page.screenshot({ path: file, type: "jpeg", quality: 80 });
      made.push(path.basename(file));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${made.length} screenshots in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
