// node docs/design/pc711-duty-card/harness/shoot.cjs   (dev server: npx vite --port 5199)
// Pictures of the proposed "Who is checking" card inside the real Admin → 7-11 Login panel:
// the four states (+ the history line) at 390 px (iPhone), 360 px (Android), 1280 px (laptop).
// Prints, for every picture: sideways overflow of the page and of the sheet, and whether any
// text of the card is cut. The card has no button; the panel's own buttons are measured.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..");
const WIDTHS = [["iphone-390", 390, 960], ["android-360", 360, 960], ["laptop-1280", 1280, 900]];
const SCENES = [
  ["1-normal", "panel=connected&card=normal&hist=1"],
  ["2-server-on-duty", "panel=connected&card=duty&reason=silent&hist=1"],
  ["3-server-on-duty-logged-out", "panel=out&card=dutyout&reason=degraded&hist=0"],
  ["4-backup-off", "panel=connected&card=off&hist=0"],
];
const EXTRA = [ // the other states of the panel + dark theme, 390 px only
  ["panel-logged-out_normal", "panel=out&card=normal&hist=1", "iphone-390", 390, 1040],
  ["panel-not-connected_backup-off", "panel=notconnected&card=off&hist=0", "iphone-390", 390, 760],
  ["panel-key-missing_backup-off", "panel=keymissing&card=off&hist=0", "iphone-390", 390, 620],
  ["2-server-on-duty_dark", "panel=connected&card=duty&reason=silent&hist=1&dark=1", "iphone-390", 390, 960],
  ["3-server-on-duty-logged-out_dark", "panel=out&card=dutyout&reason=degraded&hist=0&dark=1", "iphone-390", 390, 1040],
];
(async () => {
  const b = await chromium.launch();
  const jobs = [];
  for (const [name, qs] of SCENES) for (const [label, w, h] of WIDTHS) jobs.push([name, qs, label, w, name.startsWith("3-") && w < 1000 ? 1040 : h]);
  for (const j of EXTRA) jobs.push(j);
  for (const [name, qs, label, w, h] of jobs) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/pc711-duty-card/harness/index.html?${qs}`, { waitUntil: "networkidle" });
    await p.waitForSelector("[data-testid=duty-card]");
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const card = document.querySelector("[data-testid=duty-card-wrap]");
      let sheet = card;
      while (sheet && !(getComputedStyle(sheet).overflowY === "auto" || getComputedStyle(sheet).overflowY === "scroll")) sheet = sheet.parentElement;
      const cut = [...card.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== "inline").length;
      const r = card.getBoundingClientRect();
      const btns = [...document.querySelectorAll("button")].filter((x) => x.offsetParent && x.getAttribute("data-testid") && /^pc711-(test|disconnect|begin|alert-test)$/.test(x.getAttribute("data-testid")))
        .map((x) => `${x.getAttribute("data-testid").replace("pc711-", "")} ${Math.round(x.getBoundingClientRect().height)}px`);
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sheet: sheet ? sheet.scrollWidth - sheet.clientWidth : null,
        cut, inside: r.left >= 0 && r.right <= window.innerWidth + 0.5, cardW: Math.round(r.width), cardButtons: card.querySelectorAll("button").length, btns,
      };
    });
    const file = `${name}_${label}.png`;
    console.log(`${file}: sideways scroll page ${m.page}px, sheet ${m.sheet}px · cut text ${m.cut} · card ${m.cardW}px wide, inside the screen ${m.inside} · buttons in the card ${m.cardButtons} · panel buttons: ${m.btns.join(", ")}`);
    await p.screenshot({ path: path.join(OUT, file) });
    await p.close();
  }
  await b.close();
})();
