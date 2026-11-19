// node docs/design/choose-price/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// iPhone 390, Android 360, laptop 1280 — Live setup (OFF / ON / 6 prices / long prices) and the
// pop-up (single / queued / 6 prices / long prices / Type price / sold out / orders paused), plus
// dark mode. Prints for every picture: sideways page scroll, the smallest price-button height,
// the smallest ☆ / × size and the gap between them, and how many price labels are cut
// (label wider than its button) — must be 0.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const WIDTHS = [["iphone-390", 390, 844], ["android-360", 360, 800], ["laptop-1280", 1280, 800]];
const E = encodeURIComponent;
const SIX = "39,59,79,99,129,149";
const VIEWS = [
  ["settings-off", "view=settings"],
  ["settings-on", "view=settings&on=1"],
  ["settings-6-prices", `view=settings&on=1&prices=${SIX}`],
  ["settings-long-prices", `view=settings&on=1&cur=${E("NT$")}&prices=12000,8500,150000,990`],
  ["settings-on_dark", "view=settings&on=1&dark=1"],
  ["pop-single", "view=pop"],
  ["pop-queued", "view=pop&wait=2"],
  ["pop-6-prices", `view=pop&prices=${SIX}&wait=1`],
  ["pop-long-prices-nt", `view=pop&cur=${E("NT$")}&prices=12000,8500,150000,990,1200,350`],
  ["pop-long-prices-eur", `view=pop&cur=${E("€")}&prices=1234.5,999.99,12.5,10000,49.9`],
  ["pop-type-price", "view=pop&wait=1", "type"],
  ["pop-sold-out", "view=pop&answer=soldout", "tap"],
  ["pop-orders-paused", "view=pop&answer=blocked", "tap"],
  ["pop-single_dark", "view=pop&dark=1&wait=2"],
  ["pop-type-price_dark", "view=pop&dark=1", "type"],
];
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [name, qs, action] of VIEWS) for (const [label, w, h] of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/choose-price/harness/index.html?${qs}`, { waitUntil: "networkidle" });
    if (qs.includes("view=settings")) {
      await p.waitForSelector("[data-testid=cpp-row]");
      await p.evaluate(() => document.querySelector("[data-testid=samePrice-row]").scrollIntoView({ block: "start" }));
      await p.evaluate(() => window.scrollBy(0, -140));
    } else {
      await p.waitForSelector("[data-testid=cpp-sheet]");
      await p.waitForTimeout(550);                       // past the tap-through guard
      if (action === "type") { await p.click("[data-testid=cpp-type]"); await p.fill("[data-testid=cpp-type-input]", "125"); }
      if (action === "tap") await p.click("[data-testid=cpp-price-1]");
    }
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const all = (sel) => [...document.querySelectorAll(sel)];
      const hs = (sel) => all(sel).map((e) => Math.round(e.getBoundingClientRect().height));
      const cut = all("[data-testid^=cpp-price-]").filter((e) => e.scrollWidth > e.clientWidth).length
        + all("[data-testid^=cpp-chip-] > span:first-child").filter((e) => e.scrollWidth > e.clientWidth).length;
      const icons = all("[data-testid^=cpp-make-default-], [data-testid^=cpp-remove-]").map((e) => e.getBoundingClientRect());
      const chip = document.querySelector("[data-testid=cpp-chip-1]");
      let gap = null;
      if (chip) { const bs = [...chip.querySelectorAll("button")].map((e) => e.getBoundingClientRect()); if (bs.length === 2) gap = Math.round(bs[1].left - bs[0].right); }
      const s = document.querySelector("[data-testid=cpp-sheet]");
      return {
        sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        priceBtnMinH: Math.min(...hs("[data-testid^=cpp-price-]"), 999),
        iconMin: icons.length ? `${Math.round(Math.min(...icons.map((r) => r.width)))}x${Math.round(Math.min(...icons.map((r) => r.height)))}` : null,
        iconGap: gap, cutLabels: cut,
        sheet: s ? { top: Math.round(s.getBoundingClientRect().top), w: Math.round(s.getBoundingClientRect().width), focus: document.activeElement === s || s.contains(document.activeElement) } : null,
        bodyScroll: document.body.style.overflow || "(free)",
      };
    });
    if (m.sideScroll > 0 || m.cutLabels > 0) bad++;
    await p.screenshot({ path: path.join(OUT, `${name}_${label}.png`) });
    console.log(name, label, JSON.stringify(m));
    await p.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} picture(s) with a sideways scroll or a cut label` : "\nno sideways scroll, no cut label");
  process.exit(bad ? 1 : 0);
})();
