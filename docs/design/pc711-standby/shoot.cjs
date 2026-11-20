// node docs/design/pc711-standby/shoot.cjs   (dev server first: npx vite --port 5199)
// The REAL "Who is checking" card (docs/design/pc711-duty-card/harness, fake server answers) with the new
// "Store session" line: ready / opening / not ready, in the three backup-on states, at 360 / 390 / 430 / 1280 px.
// Prints for every picture: sideways scroll (page + sheet), cut text in the card, the card's height, the line's text.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "shots");
const WIDTHS = [["android-360", 360, 960], ["iphone-390", 390, 960], ["android-430", 430, 960], ["laptop-1280", 1280, 900]];
const SCENES = [
  ["normal-ready", "panel=connected&card=normal&hist=1&store=ready"],
  ["normal-opening", "panel=connected&card=normal&hist=1&store=opening"],
  ["normal-not-ready", "panel=out&card=normal&hist=1&store=not_ready"],
  ["on-duty-ready", "panel=connected&card=duty&reason=silent&hist=1&store=ready"],
  ["on-duty-logged-out-not-ready", "panel=out&card=dutyout&reason=degraded&hist=0&store=not_ready"],
  ["backup-off-no-line", "panel=connected&card=off&hist=0&store=ready"],
];
(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, qs] of SCENES) for (const [label, w, h] of WIDTHS) {
    if (name === "backup-off-no-line" && label !== "iphone-390") continue;
    const p = await b.newPage({ viewport: { width: w, height: name.includes("logged-out") || name.includes("not-ready") ? 1100 : h }, deviceScaleFactor: 2 });
    await p.clock.setFixedTime(new Date("2026-11-18T06:08:00Z"));
    await p.goto(`http://localhost:5199/docs/design/pc711-duty-card/harness/index.html?${qs}`, { waitUntil: "networkidle" });
    await p.waitForSelector("[data-testid=pc711-duty-line]");
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const wrap = document.querySelector("[data-testid=pc711-duty-wrap]");
      wrap.scrollIntoView({ block: "center" });
      let sheet = wrap;
      while (sheet && !(getComputedStyle(sheet).overflowY === "auto" || getComputedStyle(sheet).overflowY === "scroll")) sheet = sheet.parentElement;
      const cut = [...wrap.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== "inline").length;
      const line = document.querySelector("[data-testid=pc711-duty-store]");
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, sheet: sheet ? sheet.scrollWidth - sheet.clientWidth : null, cut,
        cardH: Math.round(document.querySelector("[data-testid=pc711-duty]").getBoundingClientRect().height),
        line: line ? `${line.previousElementSibling.textContent}: ${line.textContent}` : "(no line)" };
    });
    const file = `${name}_${label}.png`;
    await p.locator("[data-testid=pc711-duty-wrap]").screenshot({ path: path.join(OUT, file) });
    lines.push(`${file}: "${m.line}" · sideways scroll page ${m.page}px, sheet ${m.sheet}px · cut text ${m.cut} · card ${m.cardH}px tall`);
    await p.close();
  }
  require("fs").writeFileSync(path.join(__dirname, "shots.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
