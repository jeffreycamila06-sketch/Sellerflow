// Seller Website redesign proposal — puts TODAY (before/) next to PROPOSED (after-shots/) in one picture each.
// node docs/design/website-redesign/harness/compare.cjs     (needs before.cjs and after.cjs to have run)
const { chromium } = require("playwright");
const fs = require("fs"); const path = require("path");
const R = path.join(__dirname, "..");
const OUT = path.join(R, "compare"); fs.mkdirSync(OUT, { recursive: true });
const PAGES = ["home", "product", "cart", "checkout", "order"];
const VIEWS = [["iphone390", 390, "iPhone, 390 wide"], ["android412", 412, "Android, 412 wide"], ["laptop1280", 1280, "Laptop, 1280 wide"]];
const b64 = (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`;
async function sheet(browser, out, title, cells, cellW) {
  const page = await browser.newPage({ viewport: { width: cells.length * (cellW + 24) + 24, height: 300 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#ececee;font:15px/1.4 system-ui;color:#222"><div style="padding:18px 24px 6px;font-weight:700;font-size:18px">${title}</div><div style="display:flex;gap:24px;padding:10px 24px 24px;align-items:flex-start">${cells.map(([cap, f]) => `<figure style="margin:0;width:${cellW}px"><figcaption style="padding:0 0 8px;font-weight:600">${cap}</figcaption><img src="${b64(f)}" style="width:100%;display:block;border:1px solid #b9b9bd;background:#fff"></figure>`).join("")}</div></body>`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: out, type: "jpeg", quality: 80, fullPage: true });
  await page.close();
}
(async () => {
  const browser = await chromium.launch(); let n = 0;
  for (const [i, p] of PAGES.entries()) for (const [vn, w, label] of VIEWS) for (const part of ["first", "full"]) {
    const b = path.join(R, "before", `brand-${i + 1}-${p}_${vn}_${part}.jpg`), a = path.join(R, "after-shots", `budgetukay-${i + 1}-${p}_${vn}_${part}.jpg`);
    await sheet(browser, path.join(OUT, `${i + 1}-${p}_${vn}_${part}.jpg`), `${p[0].toUpperCase() + p.slice(1)} page — ${label} — ${part === "first" ? "first screen" : "whole page"} (same shop, same seller settings)`, [["Today", b], ["Proposed", a]], w >= 1000 ? 900 : w);
    n++;
  }
  // the same design with other kinds of shops
  const S = (s, pg, v) => path.join(R, "after-shots", `${s}_${v}_${pg}.jpg`);
  await sheet(browser, path.join(OUT, "shops_home_iphone390_first.jpg"), "Proposed — four kinds of shops, home page, iPhone 390, first screen", [["Clothes (Budgetukay)", S("budgetukay-1-home", "first", "iphone390")], ["Food (Sunday Oven)", S("sundayoven-1-home", "first", "iphone390")], ["Gadgets (Voltline)", S("voltline-1-home", "first", "iphone390")], ["Beauty (Dew Room)", S("dewroom-1-home", "first", "iphone390")]], 390);
  await sheet(browser, path.join(OUT, "shops_home_iphone390_full.jpg"), "Proposed — four kinds of shops, home page, iPhone 390, whole page", [["Clothes (Budgetukay)", S("budgetukay-1-home", "full", "iphone390")], ["Food (Sunday Oven)", S("sundayoven-1-home", "full", "iphone390")], ["Gadgets (Voltline)", S("voltline-1-home", "full", "iphone390")], ["Beauty (Dew Room)", S("dewroom-1-home", "full", "iphone390")]], 390);
  await sheet(browser, path.join(OUT, "shops_product_iphone390_full.jpg"), "Proposed — product page, iPhone 390, whole page", [["Clothes", S("budgetukay-2-product", "full", "iphone390")], ["Food", S("sundayoven-2-product", "full", "iphone390")], ["Gadgets", S("voltline-2-product", "full", "iphone390")]], 390);
  for (const [s, name] of [["sundayoven", "Food (Sunday Oven)"], ["voltline", "Gadgets (Voltline)"], ["dewroom", "Beauty (Dew Room)"]]) await sheet(browser, path.join(OUT, `shops_${s}_home_laptop1280_first.jpg`), `Proposed — ${name}, home page, laptop 1280, first screen`, [["", S(`${s}-1-home`, "first", "laptop1280")]], 1280);
  await browser.close();
  console.log(n + 6, "pictures in", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
