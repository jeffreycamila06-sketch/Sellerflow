// node docs/design/choose-price-free/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// iPhone 390, Android 360, laptop 1280 — light + dark:
//   the pop-up with 3 prices + Free and with 6 prices + Free (third row),
//   Settings → Live setup with "Show Free button" OFF and ON, and the Orders row showing Free.
// Prints for every picture: sideways page scroll, cut labels (must be 0), the Free cell's place in
// the grid and its height, and the switch row's height.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const WIDTHS = [["iphone-390", 390, 844], ["android-360", 360, 800], ["laptop-1280", 1280, 800]];
const SIX = "39,59,79,99,129,149";
const BASE = [
  ["pop-3-prices-free", "view=pop&free=1&prices=39,59,79"],
  ["pop-6-prices-free", `view=pop&free=1&prices=${SIX}&wait=1`],
  ["settings-free-off", "view=settings&on=1&prices=39,59,79"],
  ["settings-free-on", "view=settings&on=1&free=1&prices=39,59,79"],
  ["orders-free-row", "view=orders&cur=NT%24"],
];
const VIEWS = BASE.flatMap(([n, qs]) => [[n, qs], [`${n}_dark`, `${qs}&dark=1`]]);
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [name, qs] of VIEWS) for (const [label, w, h] of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/choose-price-free/harness/index.html?${qs}`, { waitUntil: "networkidle" });
    if (qs.includes("view=settings")) {
      await p.waitForSelector("[data-testid=cpp-free-toggle]");
      await p.evaluate(() => document.querySelector("[data-testid=cpp-row]").scrollIntoView({ block: "start" }));
      await p.evaluate(() => window.scrollBy(0, -90));
    } else if (qs.includes("view=orders")) {
      await p.waitForSelector("[data-testid=ord-free]");
    } else {
      await p.waitForSelector("[data-testid=cpp-free]");
      await p.waitForTimeout(550);                       // past the tap-through guard
    }
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const all = (sel) => [...document.querySelectorAll(sel)];
      const cut = all("[data-testid^=cpp-price-], [data-testid=cpp-free], [data-testid=ord-free]").filter((e) => e.scrollWidth > e.clientWidth).length;
      const free = document.querySelector("[data-testid=cpp-free]");
      const sw = document.querySelector("[data-testid=cpp-free-toggle]");
      const row = document.querySelector("[data-testid=ord-free]");
      const r = (e) => e.getBoundingClientRect();
      return {
        sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, cutLabels: cut,
        free: free ? { cell: `${[...free.parentElement.children].indexOf(free) + 1} of ${free.parentElement.children.length}`, last: free.parentElement.lastElementChild === free, h: Math.round(r(free).height), w: Math.round(r(free).width),
          sameSizeAsPrice: Math.round(r(free).width) === Math.round(r(document.querySelector("[data-testid=cpp-price-0]")).width) && Math.round(r(free).height) === Math.round(r(document.querySelector("[data-testid=cpp-price-0]")).height),
          color: getComputedStyle(free).color, bg: getComputedStyle(free).backgroundColor } : undefined,
        switch: sw ? { h: Math.round(r(sw).height), w: Math.round(r(sw).width), on: sw.getAttribute("aria-checked") } : undefined,
        ordersFree: row ? { text: row.textContent, color: getComputedStyle(row).color } : undefined,
      };
    });
    if (m.sideScroll > 0 || m.cutLabels > 0 || (m.free && (!m.free.last || m.free.h < 44)) || (m.switch && m.switch.h < 44)) bad++;
    await p.screenshot({ path: path.join(OUT, `${name}_${label}.png`) });
    console.log(name, label, JSON.stringify(m));
    await p.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} picture(s) with a problem` : "\nno sideways scroll, no cut label, Free always last, every target ≥ 44 px");
  process.exit(bad ? 1 : 0);
})();
