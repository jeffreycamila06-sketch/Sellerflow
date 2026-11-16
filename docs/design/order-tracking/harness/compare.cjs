// Order tracking — the PREVIEW (docs/design/order-tracking/order-tracking.html, left) next to the REAL build (right),
// iPhone / Android / laptop: the buyer's order page for the five parcel states × light / dark, pay at pickup and pay
// first, home delivery; and the seller's Website orders for each state.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/order-tracking/harness/compare.cjs [name-prefix]
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, routes } = require("../../seller-website-v2/harness/shoot.cjs");
const OUT = path.join(__dirname, "..", "compare");
fs.mkdirSync(OUT, { recursive: true });
const PREVIEW = "http://localhost:5199/docs/design/order-tracking/order-tracking.html";
const SHOP_URL = "http://localhost:5199/docs/design/seller-website-v2/harness/index.html?m=shop&path=/s/budgetukay/o/" + "f".repeat(64);
const SELLER_URL = "http://localhost:5199/docs/design/order-tracking/harness/index.html";
const ONLY = process.argv[2] || "";
const DEV = [
  ["iphone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }],
  ["android", { ...devices["Pixel 7"], deviceScaleFactor: 1 }],
  ["laptop", { viewport: { width: 1320, height: 860 }, deviceScaleFactor: 1 }],
];
const OCEAN = { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" };
const MIDNIGHT = { layout: "brand", top1: "#0b0b0f", top2: "#4c1d95", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" };
// the parcel per state + the buyer's day (Taipei) it is looked at — as the preview
const ST = {
  shipped: { day: "2026-11-17T12:00:00+08:00" },
  transit: { day: "2026-11-18T12:00:00+08:00", parcel: { state: "in_transit", checkedAt: "2026-11-18T01:40:00Z" } },
  store: { day: "2026-11-19T12:00:00+08:00", parcel: { state: "at_store", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26", checkedAt: "2026-11-19T01:40:00Z" } },
  picked: { day: "2026-11-21T20:00:00+08:00", parcel: { state: "picked_up", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26", pickedUpAt: "2026-11-21T10:42:00Z", checkedAt: "2026-11-21T01:40:00Z" } },
  returned: { day: "2026-11-27T12:00:00+08:00", parcel: { state: "returned", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26", returnedAt: "2026-11-27T00:00:00Z", checkedAt: "2026-11-27T01:40:00Z" } },
};
const orderJson = (st, ship, pay) => ({
  found: true, orderNo: "W-0001", status: "shipped", paymentIssue: false, items: [{ pid: 1, name: "TSHIRT ONEPIECE", price: 7.9, qty: 3, photo: "demo/p1.jpg" }], subtotal: 23.7, shipFee: 60, total: 83.7,
  delivery: ship === "cvs" ? "fm" : "home", ...(ship === "cvs" ? { storeId: "151003" } : { address: "No. 5, Lane 20, Taipei", courier: "Black Cat" }),
  tracking: ship === "cvs" ? "12345678901" : "TW8842001", payment: pay === "cod" ? "cod" : "bank", ...(pay === "first" ? { paidAt: "2026-11-16T15:00:00Z", receipt: true } : {}),
  buyerName: "Maria Santos", phoneTail: "782", createdAt: "2026-11-16T14:07:00Z", shippedAt: "2026-11-17T06:15:00Z",
  shop: { sub: "budgetukay", name: "Budgetukay", chats: { line: "@budgetukay", messenger: "budgetukay" }, currency: "NT$" }, country: "TW",
  ...(ship === "cvs" && ST[st].parcel ? { parcel: ST[st].parcel } : {}),
});

async function shootPreview(browser, dev, devKey, s) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/order-tracking.html", async (r) => { const res = await r.fetch(); r.fulfill({ response: res, headers: { ...res.headers(), "content-type": "text/html; charset=utf-8" } }); });
  await page.goto(PREVIEW, { waitUntil: "load" });
  await page.evaluate(([s, devKey]) => {
    /* global S, render */
    Object.assign(S, { ...s, dev: devKey }); render();
    const vp = document.querySelector("#vp"); vp.style.height = `${vp.scrollHeight}px`;
  }, [s, devKey]);
  await page.waitForTimeout(250);
  const buf = await page.locator("#dev").screenshot({ type: "jpeg", quality: 80 });
  await ctx.close();
  return buf;
}
async function shootReal(browser, dev, url, opts) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
  const page = await ctx.newPage();
  if (opts.order) await routes(page, opts.shop, opts.order);
  else { await page.route("**/fonts.googleapis.com/**", (r) => r.abort()); await page.route("**/demo.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" })); }
  await page.addInitScript((now) => { const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }; localStorage.setItem("sfl_shop_lang", "en"); }, Date.parse(opts.day));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  if (opts.click) { await page.locator(opts.click).first().click(); await page.waitForTimeout(350); }
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, ...[...document.querySelectorAll("[data-testid=wor-detail] > div")].map((e) => e.scrollHeight + 40)));
  const vp = page.viewportSize();
  if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 9000) }); await page.waitForTimeout(250); }
  const buf = await page.screenshot({ type: "jpeg", quality: 80 });
  await ctx.close();
  return buf;
}
async function compose(browser, left, right, label, wide) {
  const page = await browser.newPage({ viewport: { width: wide ? 1700 : 900, height: 400 }, deviceScaleFactor: 1 });
  const b64 = (b) => `data:image/jpeg;base64,${b.toString("base64")}`;
  await page.setContent(`<html><body style="margin:0;background:#e5e7eb;font:600 14px system-ui"><div style="display:flex;gap:16px;padding:12px;align-items:flex-start">
    <figure style="margin:0;flex:1"><figcaption style="padding:4px 0 8px">Preview (order-tracking.html) — ${label}</figcaption><div style="border:1px solid #9ca3af"><img src="${b64(left)}" style="width:100%;display:block"></div></figure>
    <figure style="margin:0;flex:1"><figcaption style="padding:4px 0 8px">Real build — ${label}</figcaption><div style="border:1px solid #9ca3af"><img src="${b64(right)}" style="width:100%;display:block"></div></figure>
  </div></body></html>`);
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: "jpeg", quality: 72, fullPage: true });
  await page.close();
  return buf;
}
const SETS = [];
for (const st of Object.keys(ST)) for (const dark of [0, 1]) SETS.push([`buyer-${st}-${dark ? "dark" : "light"}`, { who: "buyer", st, ship: "cvs", pay: "cod", dark }]);
SETS.push(["buyer-store-payfirst-light", { who: "buyer", st: "store", ship: "cvs", pay: "first", dark: 0 }]);
SETS.push(["buyer-home-delivery-light", { who: "buyer", st: "shipped", ship: "other", pay: "cod", dark: 0 }]);
for (const st of Object.keys(ST)) SETS.push([`seller-${st}`, { who: "seller", st, ship: "cvs", pay: "cod", dark: 0 }]);
SETS.push(["seller-home-delivery", { who: "seller", st: "shipped", ship: "other", pay: "cod", dark: 0 }]);
SETS.push(["seller-list-store", { who: "seller", st: "store", ship: "cvs", pay: "cod", dark: 0, list: 1 }]);

(async () => {
  const browser = await chromium.launch();
  let n = 0;
  for (const [name, s] of SETS) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const [vn, dev] of DEV) {
      const prev = await shootPreview(browser, dev, vn, s);
      const real = s.who === "buyer"
        ? await shootReal(browser, dev, SHOP_URL, { shop: (() => { const x = shopFor("pop"); return { ...x, shop: { ...x.shop, look: s.dark ? MIDNIGHT : OCEAN } }; })(), order: orderJson(s.st, s.ship, s.pay), day: ST[s.st].day })
        : await shootReal(browser, dev, `${SELLER_URL}?st=${s.st}&ship=${s.ship}&pay=${s.pay}&pickup=1`, { day: ST[s.st].day, click: s.list ? null : "[data-testid=wor-row]" });
      fs.writeFileSync(path.join(OUT, `${name}_${vn}.jpg`), await compose(browser, prev, real, `${name} · ${vn}`, vn === "laptop"));
      n++;
    }
  }
  await browser.close();
  console.log(`${n} pictures in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
