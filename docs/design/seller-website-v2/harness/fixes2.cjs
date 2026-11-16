// Seller Website v2 — before/after pictures for the two preview differences (2a header logo letter,
// 2b order-page auto-cancel countdown). Preview on the left, the real build on the right, iPhone + laptop.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/seller-website-v2/harness/fixes2.cjs before|after
// "before" for 2a = the shop as the harness drew it until now: with an uploaded logo picture (an orange "B").
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, shootShop } = require("./shoot.cjs");
const { shootPreview, compose, DEV } = require("./compare.cjs");
const MODE = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(__dirname, "..", "fix-2ab", MODE);
fs.mkdirSync(OUT, { recursive: true });
const T = "f".repeat(64);
const DEVS = DEV.filter(([vn]) => vn !== "android");

(async () => {
  const browser = await chromium.launch();
  let n = 0;
  const save = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); n++; };
  for (const [vn, dev, devKey] of DEVS) {
    const wide = vn === "laptop", crop = wide ? 120 : 150;
    // 2a — the header's round logo letter, Boutique + Bold
    for (const theme of ["boutique", "bold"]) {
      const prev = await shootPreview(browser, dev, devKey, theme, "home");
      const shop = MODE === "before" ? shopFor(theme, "TW", { logo: "demo/logo.jpg" }) : shopFor(theme);
      const real = await shootShop(browser, dev, "?m=shop&path=/s/budgetukay", { shop }, vn);
      save(`2a-${theme}-header_${vn}.jpg`, await compose(browser, prev, real, `${theme} · header · ${vn}`, wide, crop,
        MODE === "before" ? "Real build (harness shop with an uploaded logo picture)" : "Real build (no logo picture, theme colour)"));
      if (MODE === "after") {
        const own = await shootShop(browser, dev, "?m=shop&path=/s/budgetukay", { shop: shopFor(theme, "TW", { color: "#7C3AED" }) }, vn);
        save(`2a-${theme}-header-own-colour_${vn}.jpg`, await compose(browser, prev, own, `${theme} · header · ${vn}`, wide, crop, "Real build (seller picked #7C3AED)"));
      }
    }
    // 2b — the order page while payment is due
    const prev = await shootPreview(browser, dev, devKey, "pop", "track");
    const real = await shootShop(browser, dev, `?m=shop&path=/s/budgetukay/o/${T}`, { shop: shopFor("pop") }, vn);
    save(`2b-order-awaiting-payment_${vn}.jpg`, await compose(browser, prev, real, `order page · ${vn}`, wide));
  }
  await browser.close();
  console.log(`${n} pictures in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
