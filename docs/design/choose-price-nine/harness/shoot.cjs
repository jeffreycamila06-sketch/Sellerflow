// node docs/design/choose-price-nine/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// iPhone 390×844, Android 412×915, laptop 1280×800 (deviceScaleFactor 2):
//   Settings → Live setup with 9 prices (the 9-of-9 note, no Add row) and with 8 (Add row as today),
//   the price pop-up with 9 prices + Free (Free alone on its own row) and with 9 prices, Free off.
// Prints for every picture: sideways page scroll and cut labels (must be 0), the Free cell's size vs the
// price grid, the ☆ / × tap targets, how many price chips sit in one row, and whether the note is on screen.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const DEVICES = [["iphone-390x844", 390, 844], ["android-412x915", 412, 915], ["laptop-1280x800", 1280, 800]];
const NINE = "50,80,100,120,150,180,200,250,300";
const VIEWS = [
  ["settings-9-prices", `view=settings&on=1&free=1&prices=${NINE}`],
  ["settings-8-prices", "view=settings&on=1&free=1&prices=50,80,100,120,150,180,200,250"],
  ["pop-9-prices-free", `view=pop&free=1&wait=2&prices=${NINE}`],
  ["pop-9-prices", `view=pop&wait=2&prices=${NINE}`],
];
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [name, qs] of VIEWS) for (const [label, w, h] of DEVICES) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/choose-price-nine/harness/index.html?${qs}`, { waitUntil: "networkidle" });
    if (qs.includes("view=settings")) {
      await p.waitForSelector("[data-testid=cpp-area]");
      await p.evaluate(() => document.querySelector("[data-testid=cpp-row]").scrollIntoView({ block: "start" }));
      await p.evaluate(() => window.scrollBy(0, -12));
    } else {
      await p.waitForSelector("[data-testid=cpp-price-8]");
      await p.waitForTimeout(550);                       // past the tap-through guard
    }
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const all = (s) => [...document.querySelectorAll(s)];
      const r = (e) => e.getBoundingClientRect();
      const cut = all("[data-testid^=cpp-price-], [data-testid=cpp-free], [data-testid=cpp-full], [data-testid^=cpp-chip-]").filter((e) => e.scrollWidth > e.clientWidth + 1).length;
      const free = q("[data-testid=cpp-free]");
      const p0 = q("[data-testid=cpp-price-0]");
      const chips = all("[data-testid^=cpp-chip-]");
      const note = q("[data-testid=cpp-full]");
      const tops = new Set(chips.map((c) => Math.round(r(c).top)));
      const targets = all("[data-testid^=cpp-make-default-], [data-testid^=cpp-remove-]").map((e) => Math.min(Math.round(r(e).width), Math.round(r(e).height)));
      return {
        sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, cutLabels: cut,
        pop: p0 ? {
          prices: all("[data-testid^=cpp-price-]").length, priceH: Math.round(r(p0).height),
          free: free ? { w: Math.round(r(free).width), gridW: Math.round(r(free.parentElement).width), h: Math.round(r(free).height), ownRow: Math.round(r(free).left) === Math.round(r(free.parentElement).left) && Math.round(r(free).width) === Math.round(r(free.parentElement).width) } : null,
          sheetH: Math.round(r(q("[data-testid=cpp-sheet]")).height), sheetScrolls: q("[data-testid=cpp-sheet]").scrollHeight > q("[data-testid=cpp-sheet]").clientHeight,
        } : undefined,
        settings: chips.length ? {
          chips: chips.length, perRow: chips.length / tops.size, smallestTarget: targets.length ? Math.min(...targets) : null,
          addRow: !!q("[data-testid=cpp-add-input]"), note: note ? { text: note.textContent, onScreen: r(note).bottom <= window.innerHeight && r(note).top >= 0 } : null,
        } : undefined,
      };
    });
    const problem = m.sideScroll > 0 || m.cutLabels > 0
      || (m.pop && m.pop.free && (!m.pop.free.ownRow || m.pop.free.h < 44))
      || (m.settings && (m.settings.smallestTarget < 44 || (m.settings.chips === 9) !== !!m.settings.note || (m.settings.chips === 9) === m.settings.addRow));
    if (problem) bad++;
    await p.screenshot({ path: path.join(OUT, `${name}_${label}.png`) });
    console.log(name, label, JSON.stringify(m));
    await p.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} picture(s) with a problem` : "\nno sideways scroll, no cut label, Free alone on its own row at 9, every target ≥ 44 px, the note only at 9");
  process.exit(bad ? 1 : 0);
})();
