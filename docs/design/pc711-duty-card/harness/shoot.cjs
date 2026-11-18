// node docs/design/pc711-duty-card/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// Pictures of the REAL "Who is checking" card inside the real Admin → 7-11 Login panel (fake server):
// the four states at 390 px (iPhone), 360 px and 430 px (Android), 1280 px (laptop), plus the other
// states of the panel, the "could not read" case and dark theme at 390 px.
// Prints for every picture: sideways scroll of the page and of the sheet, cut text in the card,
// buttons inside the card, and the height of the panel's buttons next to it.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const WIDTHS = [["iphone-390", 390, 960], ["android-360", 360, 960], ["android-430", 430, 960], ["laptop-1280", 1280, 900]];
const SCENES = [
  ["1-normal", "panel=connected&card=normal&hist=1"],
  ["2-server-on-duty", "panel=connected&card=duty&reason=silent&hist=1"],
  ["3-server-on-duty-logged-out", "panel=out&card=dutyout&reason=degraded&hist=0"],
  ["4-backup-off", "panel=connected&card=off&hist=0"],
];
const EXTRA = [ // 390 px only
  ["panel-logged-out_normal", "panel=out&card=normal&hist=1", "iphone-390", 390, 1040],
  ["panel-not-connected_backup-off", "panel=notconnected&card=off&hist=0", "iphone-390", 390, 760],
  ["panel-key-missing_backup-off", "panel=keymissing&card=off&hist=0", "iphone-390", 390, 620],
  ["could-not-read", "panel=connected&card=failed", "iphone-390", 390, 960],
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
    await p.clock.setFixedTime(new Date("2026-11-18T06:08:00Z"));
    await p.goto(`http://localhost:5199/docs/design/pc711-duty-card/harness/index.html?${qs}`, { waitUntil: "networkidle" });
    await p.waitForSelector(qs.includes("card=failed") ? "[data-testid=pc711-duty-failed]" : "[data-testid=pc711-duty-line]");
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const wrap = document.querySelector("[data-testid=pc711-duty-wrap]");
      let sheet = wrap;
      while (sheet && !(getComputedStyle(sheet).overflowY === "auto" || getComputedStyle(sheet).overflowY === "scroll")) sheet = sheet.parentElement;
      const cut = [...wrap.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== "inline").length;
      const r = wrap.getBoundingClientRect();
      const btns = [...document.querySelectorAll("button")].filter((x) => x.offsetParent && /^pc711-(test|disconnect|begin|alert-test)$/.test(x.getAttribute("data-testid") || ""))
        .map((x) => `${x.getAttribute("data-testid").replace("pc711-", "")} ${Math.round(x.getBoundingClientRect().height)}px`);
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sheet: sheet ? sheet.scrollWidth - sheet.clientWidth : null,
        cut, inside: r.left >= 0 && r.right <= window.innerWidth + 0.5, cardW: Math.round(r.width), cardButtons: wrap.querySelectorAll("button, a, input").length, btns,
        state: document.querySelector("[data-testid=pc711-duty]").getAttribute("data-state"), text: document.querySelector("[data-testid=pc711-duty]").textContent,
      };
    });
    const file = `${name}_${label}.png`;
    console.log(`${file}: [${m.state}] sideways scroll page ${m.page}px, sheet ${m.sheet}px · cut text ${m.cut} · card ${m.cardW}px wide, inside the screen ${m.inside} · buttons in the card ${m.cardButtons} · panel buttons: ${m.btns.join(", ")}`);
    if (label === "iphone-390") console.log(`    text: ${m.text}`);
    await p.screenshot({ path: path.join(OUT, file) });
    await p.close();
  }
  await b.close();
})();
