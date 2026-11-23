// Seller Website v4 — fix (d): the chat button never covers text or buttons. Measured on the REAL build in a browser.
// For every page that has the button, at many widths, the page is scrolled top to bottom; at each stop the button's
// rectangle is compared with every piece of text, every control and every photo on screen (only the part of each
// that is really visible: a row that scrolls sideways ends at its frame).
// Run (after the two steps in built.cjs): FONT_DIR=<folder> node docs/design/website-redesign/harness/fab-check.cjs
const { chromium } = require("playwright");
const { open } = require("./built.cjs");
const WIDTHS = [[360, 740], [390, 844], [412, 915], [430, 932], [820, 1180], [860, 800], [900, 800], [1024, 768], [1180, 800], [1280, 860], [1366, 768], [1440, 900], [1920, 1080]];
const PAGES = [["home", ""], ["all products", "/shop"], ["saved", "/saved"], ["orders", "/orders"]];
(async () => {
  const browser = await chromium.launch(); let bad = 0; const lines = [];
  for (const sk of ["clothes", "food"]) for (const [pn, p] of PAGES) for (const [w, h] of WIDTHS) {
    const { ctx, page } = await open(browser, { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 860, isMobile: w < 860 }, true, sk, p, {});
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    let stops = 0, hits = 0, shown = false, example = "", lane = null;
    for (let y = 0; ; y += Math.round(h * 0.6)) {
      await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const fab = document.querySelector('[data-testid="shop-fab"]');
        if (!fab || getComputedStyle(fab).display === "none") return { shown: false, hits: [] };
        const f = fab.getBoundingClientRect(); const hits = [];
        // what is really on screen of a box: the part its scrolling / clipping parents let through
        // (a product row that scrolls sideways, a card's second photo — both end at their frame's edge)
        const vis = (a, from) => {
          let l = a.left, r = a.right, t = a.top, b = a.bottom;
          for (let e = from; e && e !== document.documentElement; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (s.overflowX !== "visible" || s.overflowY !== "visible") { const c = e.getBoundingClientRect(); l = Math.max(l, c.left); r = Math.min(r, c.right); t = Math.max(t, c.top); b = Math.min(b, c.bottom); }
          }
          return { left: l, right: r, top: t, bottom: b, width: r - l, height: b - t };
        };
        const cut = (a0, from) => { const a = vis(a0, from); return a.right > f.left + 0.5 && a.left < f.right - 0.5 && a.bottom > f.top + 0.5 && a.top < f.bottom - 0.5 && a.width > 0 && a.height > 0; };
        const seen = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false; } return true; };
        const root = document.querySelector('[data-testid="shop-root"]');
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (!n.nodeValue.trim() || fab.contains(n) || n.parentElement.closest("style,script")) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          for (const a of rg.getClientRects()) if (cut(a, n.parentElement) && seen(n.parentElement)) hits.push("text: " + n.nodeValue.trim().slice(0, 30));
        }
        for (const el of root.querySelectorAll("button,a,input,select,textarea,img,[role=button]")) {
          if (el === fab || fab.contains(el)) continue;
          if (cut(el.getBoundingClientRect(), el.parentElement) && seen(el)) hits.push(el.tagName.toLowerCase() + ": " + (el.getAttribute("data-testid") || el.className || "").toString().slice(0, 30));
        }
        // the page column's right edge (the lane the button sits in starts after it)
        const wrap = document.querySelector(".v-main .v-wrap"); const cs = wrap ? getComputedStyle(wrap) : null;
        const inner = wrap ? wrap.getBoundingClientRect().right - parseFloat(cs.paddingRight) : null;
        return { shown: true, hits, gap: inner === null ? null : Math.round(f.left - inner) };
      });
      stops++; shown = shown || r.shown; hits += r.hits.length; if (r.hits.length && !example) example = r.hits[0]; if (r.shown && r.gap !== null) lane = lane === null ? r.gap : Math.min(lane, r.gap);
      if (y + h >= total) break;
    }
    const nav = await page.evaluate(() => { const b = document.querySelector('[data-testid="bnav-chat"]'); return !!b && getComputedStyle(b.closest("nav")).display !== "none"; });
    bad += hits; if (!shown && !nav) bad++;
    lines.push(`${sk.padEnd(7)} ${pn.padEnd(12)} ${String(w).padStart(4)}px  button=${shown ? "shown" : "hidden"}  chat-in-bottom-bar=${nav ? "yes" : "no "}  stops=${String(stops).padStart(2)}  covered=${hits}${lane !== null ? `  gap-to-page-column=${lane}px` : ""}${example ? "  e.g. " + example : ""}${!shown && !nav ? "  NO WAY TO CHAT" : ""}`);
    await ctx.close();
  }
  await browser.close();
  console.log(lines.join("\n")); console.log(bad ? `FAILED: ${bad}` : `OK: the chat button covers nothing in ${lines.length} page × width cases`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
