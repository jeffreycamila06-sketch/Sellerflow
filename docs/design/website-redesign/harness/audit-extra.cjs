// Seller Website redesign — technical audit, extra checks on TODAY's buyer pages (read-only).
// Same harness and demo data as audit-measure.cjs (demo shop "Budgetukay", placeholder buyer).
//   A. colour pairs worked out with the WCAG formula (no browser needed)
//   B. the "LIVE" pill close-up, the search box size, the size of the shop's own CSS, CSS classes nobody uses
//   C. checkout on a phone: tap "Place order" with the name empty — is any error on the screen?
//   D. keyboard: how many Tab stops the Brand home has, and whether "see policy" works from the keyboard
//   E. dark looks: the same contrast check on the Midnight look and on the older "Bold" theme
// Saves ../audit-data/extra.json and two small pictures in ../audit-data/.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const { shopFor, routes, ORDER: ORDER0, NOW } = require("../../seller-website-v2/harness/shoot.cjs");
const BUYER = JSON.stringify({ name: "Demo Buyer", phone: "0900 000 000", contact: "", address: "", stores: { s711: [{ id: "123456", name: "板橋門市" }] } });
const ORDER = { ...ORDER0, buyerName: "Demo Buyer", phoneTail: "000" };
const OUT = path.join(__dirname, "..", "audit-data");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/seller-website-v2/harness/index.html?m=shop&path=/s/budgetukay";
const T = "f".repeat(64);
const OCEAN = { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" };
const MIDNIGHT = { layout: "brand", top1: "#0b0b0f", top2: "#4c1d95", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" };
const base = shopFor("pop");
const withLook = (look) => ({ ...base, shop: { ...base.shop, catPics: { Tops: "u1/site-cat-1.jpg", Hoodies: "u1/site-cat-2.jpg" }, look } });
const CART = JSON.stringify([{ pid: 4, vid: 305, qty: 1 }, { pid: 2, vid: null, qty: 1 }]);

// A. plain maths
const lum = (h) => { const n = parseInt(h.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
const mix = (a, b, t) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
const PAIRS = [
  ["grey small text #6c7080 on white", "#6c7080", "#ffffff"],
  ["grey small text #6c7080 on the Marketplace page grey #f5f5f7", "#6c7080", "#f5f5f7"],
  ["grey small text #6c7080 on the grey note box #e7e7e7 (Ocean)", "#6c7080", mix("#111111", "#ffffff", 0.9)],
  ["white on Ocean band, left end #1f4fa8", "#ffffff", "#1f4fa8"],
  ["white on Ocean band, middle", "#ffffff", mix("#1f4fa8", "#8b5cf6", 0.5)],
  ["white on Ocean band, right end #8b5cf6", "#ffffff", "#8b5cf6"],
  ["old price red #dc2626 on white", "#dc2626", "#ffffff"],
  ["error red #dc2626 on white", "#dc2626", "#ffffff"],
  ["error red #dc2626 on dark page #0e0f12", "#dc2626", "#0e0f12"],
  ["green 'Verified seller' #16a34a on white", "#16a34a", "#ffffff"],
  ["green 'Free' / progress #16a34a on white", "#16a34a", "#ffffff"],
  ["amber 'Only N left' #d97706 on white", "#d97706", "#ffffff"],
  ["status pill orange #C2410C on #FFF7ED", "#c2410c", "#fff7ed"],
  ["status pill green #047857 on #ECFDF5", "#047857", "#ecfdf5"],
  ["Marketplace orange #ee4d2d on white (prices, links)", "#ee4d2d", "#ffffff"],
  ["white on Marketplace orange #ee4d2d (buttons, badges)", "#ffffff", "#ee4d2d"],
  ["LIVE pill: grey #6c7080 on red #e11d48 (what shows today)", "#6c7080", "#e11d48"],
  ["LIVE pill: white on red #e11d48 (what was meant)", "#ffffff", "#e11d48"],
  ["input border #e6e7ec against white (can you see the box?)", "#e6e7ec", "#ffffff"],
  ["order link text #374151 on Bold theme page #0e0f12", "#374151", "#0e0f12"],
  ["chat button white on LINE green #06c755", "#ffffff", "#06c755"],
];

// contrast check that runs in the page (same rule as audit-measure.cjs, shorter output)
function contrastPass() {
  const shown = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false; } return true; };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[, /]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const pageBg = parse(getComputedStyle(document.querySelector(".sfl-v2")).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== "none") return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let col = pageBg; for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col); return col; };
  const fails = {};
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const s = n.nodeValue.trim(); if (!s) continue; const el = n.parentElement;
    if (!el || ["SCRIPT", "STYLE", "OPTION"].includes(el.tagName) || !shown(el) || el.closest(":disabled")) continue;
    const cs = getComputedStyle(el); const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
    const fg = over(fg0, bg); const a = lum(fg), b = lum(bg); const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    if (r < (large ? 3 : 4.5)) { const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""); const k = `${hex(fg)} on ${hex(bg)}`; (fails[k] = fails[k] || { pair: k, ratio: Math.round(r * 100) / 100, count: 0, eg: [] }).count++; if (fails[k].eg.length < 3) fails[k].eg.push(`${el.getAttribute("data-testid") || el.className || el.tagName} "${s.slice(0, 24)}"`); }
  }
  return Object.values(fails).sort((x, y) => x.ratio - y.ratio);
}

async function open(browser, dev, shop, p, o = {}) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
  const page = await ctx.newPage();
  await routes(page, shop, ORDER);
  await page.addInitScript(([cart, buyer, o2, now]) => {
    const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
    localStorage.setItem("sfl_shop_lang", "en");
    if (o2.cart) localStorage.setItem("sfl_shop_cart_budgetukay", cart);
    if (o2.buyer) localStorage.setItem("sfl_shop_buyer", buyer);
  }, [CART, BUYER, { cart: !!o.cart, buyer: !!o.buyer }, NOW]);
  await page.goto(BASE + p, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
  return { ctx, page };
}

(async () => {
  const out = { pairs: PAIRS.map(([what, a, b]) => ({ what, fg: a, bg: b, ratio: ratio(a, b) })) };
  const browser = await chromium.launch();
  const phone = { ...devices["iPhone 13"], deviceScaleFactor: 2 };
  const lap = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };

  // B. LIVE pill close-up, search box, CSS size, unused classes
  {
    const { ctx, page } = await open(browser, phone, withLook(OCEAN), "");
    const live = page.locator('[data-testid="shop-live"]');
    await live.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await live.screenshot({ path: path.join(OUT, "live-pill_iphone390.png") });
    out.livePill = await page.evaluate(() => { const el = document.querySelector(".v-live .v-pill"); const cs = getComputedStyle(el); return { color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize }; });
    out.shopCss = await page.evaluate(() => {
      const st = document.querySelector('[data-testid="shop-root"] > style'); const css = st ? st.textContent : "";
      const classes = [...new Set((css.match(/\.v-[a-z0-9]+/g) || []))];
      const html = document.querySelector('[data-testid="shop-root"]').outerHTML;
      return { chars: css.length, classesInCss: classes.length, classes };
    });
    for (const w of [320, 360, 390]) {
      await page.setViewportSize({ width: w, height: 700 }); await page.waitForTimeout(150); await page.evaluate(() => scrollTo(0, 0));
      out[`search@${w}`] = await page.evaluate(() => { const l = document.querySelector(".v-srch"), i = l.querySelector("input"); const r = l.getBoundingClientRect(), ri = i.getBoundingClientRect(); return { pill: `${Math.round(r.width)}x${Math.round(r.height)}`, typingArea: `${Math.round(ri.width)}x${Math.round(ri.height)}`, placeholder: i.placeholder }; });
    }
    // the chat button against the "See all" link on the first row
    await page.setViewportSize({ width: 390, height: 664 }); await page.waitForTimeout(150);
    out.fabOverlap = await page.evaluate(() => {
      const fab = document.querySelector(".v-fab").getBoundingClientRect(); const hits = [];
      for (const el of document.querySelectorAll(".v-main button, .v-main a, .v-foot button, .v-foot a, .v-foot select")) { const r = el.getBoundingClientRect(); if (r.width && r.right > fab.left && r.left < fab.right) hits.push((el.getAttribute("data-testid") || el.textContent.trim()).slice(0, 20)); }
      return { fab: `${Math.round(fab.width)}x${Math.round(fab.height)} right ${Math.round(innerWidth - fab.right)}px bottom ${Math.round(innerHeight - fab.bottom)}px`, controlsThatPassUnderIt: [...new Set(hits)].slice(0, 12), count: hits.length };
    });
    await ctx.close();
  }

  // C. checkout on a phone, name left empty
  {
    const { ctx, page } = await open(browser, phone, withLook(OCEAN), "/checkout", { cart: true, buyer: true });
    await page.locator('[data-testid="co-name"]').fill("");
    await page.evaluate(() => scrollTo(0, 400));
    await page.locator('[data-testid="co-place-phone"]').click(); await page.waitForTimeout(400);
    out.checkoutError = await page.evaluate(() => {
      const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
      const alerts = [...document.querySelectorAll('[role="alert"]')];
      const nameInput = document.querySelector('[data-testid="co-name"]');
      return { errorMessagesOnPage: alerts.length, errorMessagesOnScreen: alerts.filter(inView).length, markedFieldOnScreen: inView(nameInput), focusMovedTo: document.activeElement.getAttribute("data-testid") || document.activeElement.tagName, scrollYAfterTap: Math.round(scrollY), ariaInvalidSet: nameInput.hasAttribute("aria-invalid"), describedBy: nameInput.hasAttribute("aria-describedby") };
    });
    await page.screenshot({ path: path.join(OUT, "checkout-error_iphone390.png") });
    await ctx.close();
  }

  // D. keyboard
  {
    const { ctx, page } = await open(browser, lap, withLook(OCEAN), "");
    let stops = 0, unnamed = 0; const kinds = {};
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press("Tab");
      const k = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; return { id: el.getAttribute("data-testid") || el.tagName.toLowerCase(), named: !!(el.getAttribute("aria-label") || el.textContent.trim() || el.getAttribute("placeholder")) }; });
      if (!k) break; stops++; if (!k.named) unnamed++; kinds[k.id] = (kinds[k.id] || 0) + 1;
    }
    out.tabStopsBrandHome = { stops, unnamed, top: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8) };
    await ctx.close();
    const p2 = await open(browser, lap, withLook(OCEAN), "/p/1");
    const u = p2.page.locator('[data-testid="pd-returns"] u');
    await u.focus(); await p2.page.keyboard.press("Enter"); await p2.page.waitForTimeout(200);
    const afterEnter = await p2.page.locator('[data-testid="shop-sheet"]').count();
    await p2.page.keyboard.press(" "); await p2.page.waitForTimeout(200);
    out.seePolicyKeyboard = { opensWithEnter: afterEnter > 0, opensWithSpace: (await p2.page.locator('[data-testid="shop-sheet"]').count()) > 0 };
    await p2.ctx.close();
  }

  // E. dark looks
  for (const [name, shop] of [["midnight-look", withLook(MIDNIGHT)], ["bold-theme", shopFor("bold")]]) {
    for (const [pn, p, o] of [["home", "", {}], ["product", "/p/1", {}], ["checkout", "/checkout", { cart: true, buyer: true }], ["order", `/o/${T}`, {}]]) {
      const { ctx, page } = await open(browser, phone, shop, p, o);
      out[`dark:${name}:${pn}`] = await page.evaluate(contrastPass);
      if (pn === "order") await page.screenshot({ path: path.join(OUT, `dark-${name}-order_iphone390.png`) });
      await ctx.close();
    }
  }
  await browser.close();

  // unused CSS classes: in the shop's CSS but in no component file
  const src = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? (d.name === "__tests__" ? [] : src(path.join(dir, d.name))) : /\.tsx?$/.test(d.name) && !/styles\.ts$|shopStyle\.ts$/.test(d.name) ? [path.join(dir, d.name)] : []);
  const code = src(path.join(__dirname, "..", "..", "..", "..", "src", "website")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const unused = out.shopCss.classes.filter((c) => !new RegExp(`\\b${c.slice(1)}\\b`).test(code));
  out.shopCss.unusedClasses = unused; out.shopCss.unusedCount = unused.length; delete out.shopCss.classes;
  fs.writeFileSync(path.join(OUT, "extra.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
