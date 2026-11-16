// Seller Website v2 — every buyer page, 3 themes × iPhone / Android / laptop: the PREVIEW
// (docs/design/seller-website-v2/site-v2.html, left) next to the REAL build (right), one picture each.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/seller-website-v2/harness/compare.cjs [theme] [page-prefix]
// Pictures at 1× (so the set stays small); the real build is the harness page running the shop app.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, PAGES, THEMES, shootShop } = require("./shoot.cjs");
const OUT = path.join(__dirname, "..", "compare");
fs.mkdirSync(OUT, { recursive: true });
const PREVIEW = "http://localhost:5199/docs/design/seller-website-v2/site-v2.html";
const [ONLY_T, ONLY_P] = process.argv.slice(2);
const DEV = [
  ["iphone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }, "iphone"],
  ["android", { ...devices["Pixel 7"], deviceScaleFactor: 1 }, "android"],
  ["laptop", { viewport: { width: 1320, height: 860 }, deviceScaleFactor: 1 }, "laptop"],
];
const PREVIEW_VIEW = { "1-home": "home", "2-shop": "list", "3-product": "pdp", "4-cart": "cart", "5-checkout": "checkout", "6-order": "track", "7-saved": "wish", "8-orders": "track-empty" };
const THEME_CLASS = { pop: "t-pop", boutique: "t-bou", bold: "t-bold" };

async function shootPreview(browser, dev, devKey, theme, view) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  // the preview file has no <meta charset>: serve it as UTF-8 so its text reads right
  await page.route("**/site-v2.html", async (r) => { const res = await r.fetch(); r.fulfill({ response: res, headers: { ...res.headers(), "content-type": "text/html; charset=utf-8" } }); });
  await page.goto(PREVIEW, { waitUntil: "load" });
  await page.evaluate(([devKey, cls, view]) => {
    /* global S, go, totals, render, fit */
    document.querySelector(`#segDev [data-d="${devKey}"]`).click();
    document.querySelector(`#segTh [data-t="${cls}"]`).click();
    if (view === "pdp") { S.pid = 1; S.sel = { col: 0, size: "L", q: 1, img: 0 }; }
    if (view === "track") { S.order = { no: "W-1042", ...totals(), ship: "s711", pay: "bank", store: "板橋門市" }; }
    if (view === "track-empty") { S.order = null; view = "track"; }
    go(view);
    render();
    removeEventListener("resize", fit); // a tall capture resizes the window: keep the full-height page
    const vp = document.querySelector("#vp"), sc = document.querySelector("#scr");
    vp.style.height = `${sc.scrollHeight + document.querySelector("#bottom").offsetHeight + (vp.offsetHeight - sc.offsetHeight - document.querySelector("#bottom").offsetHeight)}px`;
  }, [devKey, THEME_CLASS[theme], view]);
  await page.waitForTimeout(300);
  const buf = await page.locator("#vp").screenshot({ type: "jpeg", quality: 80 });
  await ctx.close();
  return buf;
}

// crop = show only the top N px of each picture (the header); rightLabel = the caption of the right picture
async function compose(browser, left, right, label, wide, crop = 0, rightLabel = "Real build") {
  const page = await browser.newPage({ viewport: { width: wide ? 1700 : 900, height: 400 }, deviceScaleFactor: 1 });
  const b64 = (b) => `data:image/jpeg;base64,${b.toString("base64")}`;
  const box = crop ? `height:${crop}px;overflow:hidden;` : "";
  await page.setContent(`<html><body style="margin:0;background:#e5e7eb;font:600 14px system-ui">
    <div style="display:flex;gap:16px;padding:12px;align-items:flex-start">
      <figure style="margin:0;flex:1"><figcaption style="padding:4px 0 8px">Preview (site-v2.html) — ${label}</figcaption><div style="${box}border:1px solid #9ca3af"><img src="${b64(left)}" style="width:100%;display:block"></div></figure>
      <figure style="margin:0;flex:1"><figcaption style="padding:4px 0 8px">${rightLabel} — ${label}</figcaption><div style="${box}border:1px solid #9ca3af"><img src="${b64(right)}" style="width:100%;display:block"></div></figure>
    </div></body></html>`);
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: "jpeg", quality: 72, fullPage: true });
  await page.close();
  return buf;
}

module.exports = { shootPreview, compose, DEV, PREVIEW_VIEW };
if (require.main === module) (async () => {
  const browser = await chromium.launch();
  let n = 0;
  for (const theme of THEMES) {
    if (ONLY_T && theme !== ONLY_T) continue;
    for (const [name, p, o] of PAGES) {
      if (ONLY_P && !name.startsWith(ONLY_P)) continue;
      for (const [vn, dev, devKey] of DEV) {
        const real = await shootShop(browser, dev, `?m=shop&path=/s/budgetukay${p}`, { ...o, shop: shopFor(theme) }, vn);
        const prev = await shootPreview(browser, dev, devKey, theme, PREVIEW_VIEW[name]);
        const out = await compose(browser, prev, real, `${theme} · ${name.slice(2)} · ${vn}`, vn === "laptop");
        fs.writeFileSync(path.join(OUT, `${theme}-${name}_${vn}.jpg`), out);
        n++;
      }
    }
  }
  await browser.close();
  console.log(`${n} side-by-side pictures in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
