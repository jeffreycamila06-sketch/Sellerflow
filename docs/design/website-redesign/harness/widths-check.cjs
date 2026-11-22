// Seller Website v4 — the new look at the phone widths of the project's mobile-first rule (360 / 390 / 430) + 412:
// no sideways page scroll, the shop name is shown in full, and every tap target in the header and the bottom bar
// is at least 44 px. Run like built.cjs.
const { chromium } = require("playwright");
const { open, SHOPS, T } = require("./built.cjs");
(async () => {
  const browser = await chromium.launch(); let bad = 0; const lines = [];
  for (const sk of ["clothes", "food"]) for (const [pn, p, o] of [["home", "", {}], ["product", SHOPS[sk].product, { click: SHOPS[sk].click }], ["cart", "/cart", { cart: true }], ["checkout", "/checkout", { cart: true, buyer: true }], ["order", `/o/${T}`, {}]])
    for (const [w, h] of [[360, 740], [390, 844], [412, 915], [430, 932]]) {
      const { ctx, page, errs } = await open(browser, { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }, true, sk, p, o);
      const r = await page.evaluate(() => {
        const de = document.documentElement; const nm = document.querySelector('[data-testid="shop-name"]');
        const small = [...document.querySelectorAll(".v-hdr button, .v-bnav button")].filter((b) => { const s = getComputedStyle(b); if (s.display === "none") return false; const q = b.getBoundingClientRect(); return q.width > 0 && (q.width < 43.5 || q.height < 43.5); }).map((b) => b.getAttribute("data-testid"));
        return { side: de.scrollWidth - de.clientWidth, cut: nm ? nm.scrollWidth - nm.clientWidth : -1, shown: nm ? getComputedStyle(nm).display !== "none" && nm.getBoundingClientRect().width > 0 : false, small };
      });
      const ok = r.side <= 0 && r.shown && r.cut <= 0 && r.small.length === 0 && errs.length === 0; if (!ok) bad++;
      lines.push(`${sk.padEnd(7)} ${pn.padEnd(8)} ${w}px  sideways=${r.side}  name-shown=${r.shown}  name-cut=${r.cut}px  small-targets=${r.small.length ? r.small.join(",") : 0}${errs.length ? "  ERR " + errs[0] : ""}${ok ? "" : "  <-- "}`);
      await ctx.close();
    }
  await browser.close(); console.log(lines.join("\n")); console.log(bad ? `FAILED: ${bad}` : `OK: ${lines.length} page × width cases`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
