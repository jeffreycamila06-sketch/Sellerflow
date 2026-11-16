// Seller Website v3 — the PREVIEW (docs/design/seller-website-v3/site-v3.html, left) next to the REAL build
// (right) at iPhone / Android / laptop: Brand store × the 5 ready combinations, Marketplace × light and dark,
// and one deliberately bad colour pick (the contrast guard). Plus the editor and a full Brand-store order at
// phone width (real build only).
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/seller-website-v3/harness/compare.cjs [name-prefix]
// The real build = the v2 harness page running the shop app; its database calls are answered with demo data.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, shootShop } = require("../../seller-website-v2/harness/shoot.cjs");
const { compose: compose2 } = require("../../seller-website-v2/harness/compare.cjs");
void compose2;
async function compose(browser, left, right, label, wide) {
  const page = await browser.newPage({ viewport: { width: wide ? 1700 : 900, height: 400 }, deviceScaleFactor: 1 });
  const b64 = (b) => `data:image/jpeg;base64,${b.toString("base64")}`;
  await page.setContent(`<html><body style="margin:0;background:#e5e7eb;font:600 14px system-ui"><div style="display:flex;gap:16px;padding:12px;align-items:flex-start">
    <figure style="margin:0;flex:1"><figcaption style="padding:4px 0 8px">Preview (site-v3.html) — ${label}</figcaption><div style="border:1px solid #9ca3af"><img src="${b64(left)}" style="width:100%;display:block"></div></figure>
    <figure style="margin:0;flex:1"><figcaption style="padding:4px 0 8px">Real build — ${label}</figcaption><div style="border:1px solid #9ca3af"><img src="${b64(right)}" style="width:100%;display:block"></div></figure>
  </div></body></html>`);
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: "jpeg", quality: 72, fullPage: true });
  await page.close();
  return buf;
}
const OUT = path.join(__dirname, "..", "compare");
fs.mkdirSync(OUT, { recursive: true });
const PREVIEW = "http://localhost:5199/docs/design/seller-website-v3/site-v3.html";
const ONLY = process.argv[2] || "";
const DEV = [
  ["iphone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }],
  ["android", { ...devices["Pixel 7"], deviceScaleFactor: 1 }],
  ["laptop", { viewport: { width: 1320, height: 860 }, deviceScaleFactor: 1 }],
];
// the preview's CFG keys ↔ the app's look
const FONT = { modern: "grotesk", friendly: "jakarta", classic: "serif" };
const PRESETS = {
  ocean: { top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" },
  midnight: { top1: "#0b0b0f", top2: "#4c1d95", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" },
  blush: { top1: "#f472b6", top2: "#fb923c", btn: "#be185d", sale: "#e11d48", dark: false, font: "friendly", corners: "round" },
  forest: { top1: "#2f4a3a", top2: "#84a98c", btn: "#2f4a3a", sale: "#b45309", dark: false, font: "classic", corners: "sharp" },
  sunset: { top1: "#ff7a45", top2: "#c81e4a", btn: "#ee4d2d", sale: "#ee4d2d", dark: false, font: "friendly", corners: "round" },
};
const BAD = { top1: "#ffffff", top2: "#000000", btn: "#fff7cc", sale: "#fde68a", dark: false, font: "modern", corners: "sharp" };
const CAT_PICS = { Tops: "u1/site-cat-1.jpg", Hoodies: "u1/site-cat-2.jpg", Bottoms: "u1/site-cat-3.jpg", "Bags & Caps": "u1/site-cat-4.jpg" };
const shopWith = (look) => { const s = shopFor("pop"); return { ...s, shop: { ...s.shop, catPics: CAT_PICS, look } }; };
const SETS = [];
for (const [k, v] of Object.entries(PRESETS)) SETS.push([`brand-${k}`, { layout: "brand", ...v }]);
SETS.push(["market-light", { layout: "market", ...PRESETS.ocean }]);
SETS.push(["market-dark", { layout: "market", ...PRESETS.midnight }]);
SETS.push(["guard-bad-colours", { layout: "brand", ...BAD }]);

async function shootPreview(browser, dev, devKey, look) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/site-v3.html", async (r) => { const res = await r.fetch(); r.fulfill({ response: res, headers: { ...res.headers(), "content-type": "text/html; charset=utf-8" } }); });
  await page.goto(PREVIEW, { waitUntil: "load" });
  await page.evaluate(([devKey, cfg]) => {
    /* global CFG, applyCfg, go, render, fit */
    document.querySelector(`#segDev [data-d="${devKey}"]`).click();
    Object.assign(CFG, cfg);
    applyCfg();
    go("home"); render();
    removeEventListener("resize", fit);
    const vp = document.querySelector("#vp"), sc = document.querySelector("#scr"), bt = document.querySelector("#bottom");
    vp.style.height = `${sc.scrollHeight + bt.offsetHeight + (vp.offsetHeight - sc.offsetHeight - bt.offsetHeight)}px`;
  }, [devKey, { layout: look.layout, top1: look.top1, top2: look.top2, btn: look.btn, sale: look.sale, dark: look.dark ? 1 : 0, font: FONT[look.font], sharp: look.corners === "sharp" ? 1 : 0 }]);
  await page.waitForTimeout(300);
  const buf = await page.locator("#vp").screenshot({ type: "jpeg", quality: 80 });
  await ctx.close();
  return buf;
}

// the editor (real build) at a width: its Look section with the live preview
async function shootEditor(browser, dev, qs, after) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/demo.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ddd"/></svg>' }));
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.goto(`http://localhost:5199/docs/design/seller-website-v2/harness/index.html${qs}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (after) await after(page);
  await page.locator('[data-testid="wed-look"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -90));
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ type: "jpeg", quality: 80 });
  await ctx.close();
  return buf;
}

(async () => {
  const browser = await chromium.launch();
  let n = 0;
  for (const [name, look] of SETS) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const [vn, dev] of DEV) {
      const real = await shootShop(browser, dev, "?m=shop&path=/s/budgetukay", { shop: shopWith(look) }, vn);
      const prev = await shootPreview(browser, dev, vn, look);
      fs.writeFileSync(path.join(OUT, `${name}_${vn}.jpg`), await compose(browser, prev, real, `${name} · ${vn}`, vn === "laptop"));
      n++;
    }
  }
  // the editor: an existing shop (no look → Marketplace with its theme's values), a new website (Brand + Ocean),
  // and the bad pick with the guard line
  if (!ONLY || ONLY.startsWith("editor")) {
    const iphone = DEV[0][1], laptop = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
    const set = async (page, id, v) => { await page.locator(`[data-testid="${id}"]`).evaluate((el, val) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v); };
    const bad = async (page) => { await page.locator('[data-testid="wed-layout-brand"]').click(); for (const [k, v] of [["wed-top1", "#ffffff"], ["wed-top2", "#000000"], ["wed-btn", "#fff7cc"], ["wed-sale", "#fde68a"]]) await set(page, k, v); };
    for (const [nm, qs, after] of [["editor-existing-shop", "?m=editor&plan=pro", null], ["editor-new-website", "?m=editor&plan=pro&new=1", null], ["editor-guard-line", "?m=editor&plan=pro", bad]]) {
      for (const [vn, dev] of [["iphone", iphone], ["laptop", laptop]]) { fs.writeFileSync(path.join(OUT, `${nm}_${vn}.jpg`), await shootEditor(browser, dev, qs, after)); n++; }
    }
  }
  await browser.close();
  console.log(`${n} pictures in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
