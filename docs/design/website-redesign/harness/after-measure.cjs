// Measures the MOCK at phone width: tap targets under 44 px, text under 12 px, sideways scroll, and the
// contrast of the main colour pairs. Prints numbers only. Same run notes as after.cjs.
const { chromium, devices } = require("playwright");
const path = require("path"); const fs = require("fs");
const BASE = "http://localhost:5199/docs/design/website-redesign/after/mock.html";
(async () => {
  const browser = await chromium.launch(); const dir = process.env.FONT_DIR; const out = [];
  for (const [shop, pg] of [["budgetukay", "home"], ["budgetukay", "product"], ["budgetukay", "cart"], ["budgetukay", "checkout"], ["budgetukay", "order"], ["voltline", "home"], ["dewroom", "home"], ["sundayoven", "home"]]) {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] }); const page = await ctx.newPage();
    await page.route("**/fonts.googleapis.com/**", (r) => (dir ? r.fulfill({ status: 200, contentType: "text/css", body: fs.readFileSync(path.join(dir, "latin.css"), "utf8") }) : r.abort()));
    await page.route("**/fonts.gstatic.com/**", (r) => { const f = dir && path.join(dir, path.basename(new URL(r.request().url()).pathname)); return f && fs.existsSync(f) ? r.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(f) }) : r.abort(); });
    await page.goto(`${BASE}?shop=${shop}&page=${pg}&bare=1`, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
      const taps = [...document.querySelectorAll("a,button,[role=button],label.choice")].filter((e) => e.offsetParent !== null);
      const size = (e) => { const r = e.getBoundingClientRect(); const a = getComputedStyle(e, "::after"); const grow = a.content !== "none" && a.position === "absolute" ? 12 : 0; return [r.width + grow, r.height + grow]; };
      const small = taps.filter((e) => { const [w, h] = size(e); return Math.min(w, h) < 44; });
      const inline = small.filter((e) => getComputedStyle(e).display === "inline");
      const texts = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode; if (!n.nodeValue.trim() || !n.parentElement.offsetParent) continue; texts.push(parseFloat(getComputedStyle(n.parentElement).fontSize)); }
      const cs = getComputedStyle(document.querySelector(".shop")); const v = (k) => cs.getPropertyValue(k).trim();
      const probe = (c) => { const d = document.createElement("i"); d.style.color = c; document.body.appendChild(d); const o = getComputedStyle(d).color; d.remove(); return o; };
      const P = probe(v("--paper"));
      return { taps: taps.length, under44: small.length, under44_inlineTextLinks: inline.length, under44_names: small.filter((e) => !inline.includes(e)).slice(0, 6).map((e) => (e.getAttribute("aria-label") || e.textContent.trim()).slice(0, 18) + " " + size(e).map(Math.round).join("x")),
        texts: texts.length, under12: texts.filter((x) => x < 12).length, smallest: Math.min(...texts), sizes: [...new Set(texts)].sort((a, b) => a - b).join(" "),
        sideways: document.documentElement.scrollWidth - innerWidth,
        contrast: { text: ratio(probe(v("--ink")), P), helper: ratio(probe(v("--ink2")), P), onSign: ratio(probe(v("--on-sign")), probe(v("--sign"))), onButton: ratio(probe(v("--on-btn")), probe(v("--btn"))), salePrice: ratio(probe(v("--sale-t")), P), onSaleTag: ratio(probe(v("--on-sale")), probe(v("--sale"))) } };
    });
    out.push({ shop, page: pg, ...m }); await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, "..", "after-measure.json"), JSON.stringify(out, null, 1));
  for (const o of out) console.log(`${o.shop}/${o.page}: taps ${o.taps}, under 44px ${o.under44} (of which inline text links ${o.under44_inlineTextLinks}) ${JSON.stringify(o.under44_names)} | text under 12px ${o.under12}/${o.texts}, smallest ${o.smallest} | sizes ${o.sizes} | sideways ${o.sideways} | ${JSON.stringify(o.contrast)}`);
})().catch((e) => { console.error(e); process.exit(1); });
