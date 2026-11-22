// Seller Website redesign — technical audit, measurements of TODAY's buyer pages (read-only).
// Opens the real shop app through the v2 harness (demo shop "Budgetukay", every database call answered
// with demo data, the buyer is the placeholder "Demo Buyer / 0900 000 000") and MEASURES the rendered page:
// sideways scroll, tap-target sizes, text sizes, text contrast, headings, landmarks, pictures, keyboard focus.
// It changes nothing and saves only its own numbers to ../audit-data/measure.json.
// Run: (dev server already on :5199)  FONT_DIR=<fonts folder> node docs/design/website-redesign/harness/audit-measure.cjs
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
const base = shopFor("pop");
const BRAND = { ...base, shop: { ...base.shop, catPics: { Tops: "u1/site-cat-1.jpg", Hoodies: "u1/site-cat-2.jpg" }, look: OCEAN } };
const MARKET = base;
const VIEWS = [
  ["w320", { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ["iphone390", { ...devices["iPhone 13"], deviceScaleFactor: 2 }],
  ["laptop1280", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }],
];
const CART = JSON.stringify([{ pid: 4, vid: 305, qty: 1 }, { pid: 2, vid: null, qty: 1 }]);
const PAGES = [
  ["brand-home", "", { shop: BRAND }],
  ["brand-product", "/p/1", { shop: BRAND }],
  ["brand-cart", "/cart", { shop: BRAND, cart: true }],
  ["brand-checkout", "/checkout", { shop: BRAND, cart: true, buyer: true }],
  ["brand-order", `/o/${T}`, { shop: BRAND }],
  ["market-home", "", { shop: MARKET }],
];

// runs inside the page
function measure() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const shown = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false; } return true; };
  const name = (el) => {
    const id = el.getAttribute("data-testid");
    const cls = (el.className && typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${id ? `[${id}]` : ""}`;
  };
  const out = {};
  // 1. sideways scroll
  const de = document.documentElement;
  out.viewport = { w: innerWidth, h: innerHeight };
  out.scroll = { docW: de.scrollWidth, docH: de.scrollHeight, sideways: de.scrollWidth > innerWidth + 1 };
  // elements that stick out of the screen on the right (not inside a sideways-scrolling row)
  const inScroller = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true; } return false; };
  out.sticksOut = [...document.querySelectorAll("body *")].filter((el) => vis(el) && shown(el) && !inScroller(el) && el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((el) => `${name(el)} right=${Math.round(el.getBoundingClientRect().right)}`);

  // 2. tap targets
  const tappable = [...document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, summary, [role=button], [role=link], [tabindex="0"]')].filter((el) => vis(el) && shown(el));
  const targets = tappable.map((el) => { const r = el.getBoundingClientRect(); return { n: name(el), w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24), disabled: !!el.disabled }; });
  out.targets = { total: targets.length, under44: targets.filter((t) => t.w < 44 || t.h < 44).length, under24: targets.filter((t) => t.w < 24 || t.h < 24).length };
  const group = {};
  for (const t of targets) { if (t.w >= 44 && t.h >= 44) continue; const k = `${t.n}`; (group[k] = group[k] || { n: k, count: 0, w: t.w, h: t.h, label: t.label }).count++; }
  out.targets.small = Object.values(group).sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h)).slice(0, 40);

  // 3. text: sizes + contrast
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[, /]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = []; let picture = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") { picture = true; break; }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    if (picture) return null;
    let col = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col);
    return col;
  };
  const sizes = {}; const fails = {}; let texts = 0, onPicture = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.trim(); if (!s) continue;
    const el = n.parentElement; if (!el || ["SCRIPT", "STYLE", "OPTION"].includes(el.tagName) || !shown(el)) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    const px = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    sizes[px] = (sizes[px] || 0) + 1; texts++;
    const fg0 = parse(cs.color); const bg = bgOf(el);
    if (!fg0) continue;
    if (!bg) { onPicture++; continue; }
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity || "1");
    const fg = over({ ...fg0, a: fg0.a * op }, bg);
    const a = lum(fg), b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      const k = `${hex(fg)} on ${hex(bg)}`;
      (fails[k] = fails[k] || { pair: k, ratio: Math.round(ratio * 100) / 100, need, count: 0, px: [], eg: [] }).count++;
      if (!fails[k].px.includes(px)) fails[k].px.push(px);
      if (fails[k].eg.length < 4) fails[k].eg.push(`${name(el)} "${s.slice(0, 26)}"${el.closest(":disabled") ? " (disabled)" : ""}`);
    }
  }
  out.text = { nodes: texts, onPictureOrGradient: onPicture, sizes: Object.entries(sizes).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}px×${v}`), under12: Object.entries(sizes).filter(([k]) => +k < 12).reduce((a, [, v]) => a + v, 0), distinctSizes: Object.keys(sizes).length };
  out.contrastFails = Object.values(fails).sort((a, b) => a.ratio - b.ratio);

  // 4. headings + landmarks
  out.headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => shown(h)).map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 28)}`);
  out.hiddenH1 = [...document.querySelectorAll("h1")].filter((h) => !shown(h)).length;
  out.landmarks = ["header", "nav", "main", "footer", "aside", "[role=banner]", "[role=navigation]", "[role=main]", "[role=contentinfo]", "[role=search]", "form"].map((s) => `${s}:${document.querySelectorAll(s).length}`).join(" ");
  out.lang = document.documentElement.lang; out.title = document.title;
  out.skipLink = !!document.querySelector('a[href^="#"]');

  // 5. pictures
  const imgs = [...document.querySelectorAll("img")];
  out.images = {
    total: imgs.length, lazy: imgs.filter((i) => i.loading === "lazy").length, noAlt: imgs.filter((i) => !i.hasAttribute("alt")).length,
    emptyAlt: imgs.filter((i) => i.getAttribute("alt") === "").length, withAlt: imgs.filter((i) => (i.getAttribute("alt") || "").length > 0).map((i) => i.getAttribute("alt").slice(0, 30)),
    noSize: imgs.filter((i) => !i.hasAttribute("width") && !i.hasAttribute("height")).length, srcset: imgs.filter((i) => i.srcset).length, asyncDecode: imgs.filter((i) => i.decoding === "async").length,
    fullPhotoInSmallBox: imgs.filter((i) => vis(i) && !/-s\.jpg/.test(i.src) && i.getBoundingClientRect().width <= 120).map((i) => `${Math.round(i.getBoundingClientRect().width)}px box ← ${i.src.split("/").pop()}`).slice(0, 12),
    eagerBelowFold: imgs.filter((i) => i.loading !== "lazy" && i.getBoundingClientRect().top > innerHeight).length,
  };
  // interactive things without a name
  out.noName = tappable.filter((el) => !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.textContent.trim() || el.getAttribute("title") || el.getAttribute("placeholder") || (el.labels && el.labels.length) || el.closest("label"))).map(name).slice(0, 12);
  out.weakNames = tappable.filter((el) => /^[0-9+−\-‹›×]$/.test((el.getAttribute("aria-label") || el.textContent || "").trim())).map((el) => `${name(el)} "${(el.getAttribute("aria-label") || el.textContent).trim()}"`).slice(0, 12);
  out.inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=file]),select,textarea")].filter(shown).map((el) => ({ n: name(el), label: !!(el.getAttribute("aria-label") || (el.labels && el.labels.length)), required: el.required || el.getAttribute("aria-required") === "true", invalidAttr: el.hasAttribute("aria-invalid"), type: el.type, autocomplete: el.autocomplete || "" }));
  out.dom = { nodes: document.querySelectorAll("*").length, styleTags: document.querySelectorAll("style").length, inlineStyled: document.querySelectorAll("[style]").length, styleChars: [...document.querySelectorAll("style")].reduce((a, s) => a + s.textContent.length, 0) };
  return out;
}

// keyboard pass: press Tab n times, record what gets focus and whether a focus ring is drawn
async function keyboard(page, n) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
      const p = el.closest("label"); const pcs = p ? getComputedStyle(p) : null;
      const parentRing = !!pcs && pcs.outlineStyle !== "none" && parseFloat(pcs.outlineWidth) > 0;
      return { n: `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}`, ring, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, parentRing, onScreen: r.bottom > 0 && r.top < innerHeight, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20) };
    }));
  }
  return seen;
}

(async () => {
  const browser = await chromium.launch();
  const all = {};
  for (const [pname, p, o] of PAGES) {
    for (const [vn, dev] of VIEWS) {
      const ctx = await browser.newContext({ ...dev, locale: "en-US", timezoneId: "Asia/Taipei" });
      const page = await ctx.newPage();
      await routes(page, o.shop, ORDER);
      if (process.env.FONT_DIR) {
        const dir = process.env.FONT_DIR;
        await page.unroute("**/fonts.googleapis.com/**");
        await page.route("**/fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: fs.readFileSync(path.join(dir, "shop-latin.css"), "utf8") }));
        await page.route("**/fonts.gstatic.com/**", (r) => { const f = path.join(dir, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) }) : r.abort(); });
      }
      const fontReq = [];
      page.on("request", (r) => { if (/fonts\.gstatic\.com/.test(r.url())) fontReq.push(path.basename(new URL(r.url()).pathname)); });
      await page.addInitScript(([cart, buyer, o2, now]) => {
        const D = Date;
        globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
        localStorage.setItem("sfl_shop_lang", "en");
        if (o2.cart) localStorage.setItem("sfl_shop_cart_budgetukay", cart);
        if (o2.buyer) localStorage.setItem("sfl_shop_buyer", buyer);
      }, [CART, BUYER, { cart: !!o.cart, buyer: !!o.buyer }, NOW]);
      await page.goto(BASE + p, { waitUntil: "networkidle" });
      if (process.env.FONT_DIR) await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=shop-html" });
      await page.waitForTimeout(500); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
      const m = await page.evaluate(measure);
      m.fontFiles = [...new Set(fontReq)];
      if (vn === "laptop1280") m.keyboard = await keyboard(page, pname === "brand-home" ? 30 : 22);
      all[`${pname}@${vn}`] = m;
      await ctx.close();
    }
  }

  // dialogs: the cart panel (Brand store) and the chat sheet — where does focus go, does Escape close, is the page behind still reachable
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "en-US", timezoneId: "Asia/Taipei" });
    const page = await ctx.newPage();
    await routes(page, BRAND, ORDER);
    await page.addInitScript(([cart]) => { localStorage.setItem("sfl_shop_lang", "en"); localStorage.setItem("sfl_shop_cart_budgetukay", cart); }, [CART]);
    await page.goto(BASE, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
    const d = {};
    await page.locator('[data-testid="shop-cart-btn"]').focus();
    await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    d.panelOpen = await page.locator('[data-testid="brand-cart-panel"]').count();
    d.focusAfterOpen = await page.evaluate(() => { const el = document.activeElement; return { tag: el.tagName, testid: el.getAttribute("data-testid"), insideDialog: !!el.closest('[role="dialog"]') }; });
    const outside = [];
    for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); outside.push(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))); }
    d.tabStopsInsideDialog = outside.filter(Boolean).length; d.tabStopsOutsideDialog = outside.filter((x) => !x).length;
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    d.escapeCloses = (await page.locator('[data-testid="brand-cart-panel"]').count()) === 0;
    d.pageScrollLockedBehind = await page.evaluate(() => getComputedStyle(document.body).overflow === "hidden" || getComputedStyle(document.documentElement).overflow === "hidden");
    all.dialog = d;
    await ctx.close();
  }

  // reduced motion + scroll: does the header on the Brand home re-render on scroll; any animation running
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce", locale: "en-US" });
    const page = await ctx.newPage();
    await routes(page, BRAND, ORDER);
    await page.addInitScript(() => localStorage.setItem("sfl_shop_lang", "en"));
    await page.goto(BASE, { waitUntil: "networkidle" }); await page.waitForTimeout(400);
    all.motion = await page.evaluate(() => {
      const withTransition = [...document.querySelectorAll("body *")].filter((el) => { const cs = getComputedStyle(el); return cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0) || cs.animationName !== "none"; });
      return { reducedMotionMatches: matchMedia("(prefers-reduced-motion: reduce)").matches, elementsStillAnimatingOrTransitioning: withTransition.length, eg: withTransition.slice(0, 3).map((el) => el.className) };
    });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "measure.json"), JSON.stringify(all, null, 1));
  console.log("saved", path.join(OUT, "measure.json"), Object.keys(all).length, "entries");
})().catch((e) => { console.error(e); process.exit(1); });
