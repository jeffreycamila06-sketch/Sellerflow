// node docs/design/shopee-no-beta/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// Pictures (en at 360/390/430/1280, dark at 390, th + vi at 360) and a fit check in ALL 8 languages at 360 px:
// no sideways scroll, no tile text cut off, no "Beta" word anywhere on the page, how many lines each tile line takes.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5199/docs/design/shopee-no-beta/harness/index.html";
const STATES = ["days", "freelock", "ended", "grid"];
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const WIDTHS = [["360", 360, 780], ["390", 390, 844], ["430", 430, 932], ["1280", 1280, 800]];

function measure() {
  const all = (s) => Array.from(document.querySelectorAll(s));
  const BETA = /\bbeta\b|測試版|测试版|เบต้า|Бета/i;
  const tiles = all("[data-testid^=lpk-tile-], button[data-testid^=cg-]").filter((e) => e.getBoundingClientRect().width > 0);
  const cut = tiles.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.dataset.testid);
  const lines = {};
  for (const e of all("[data-testid^=lpk-tile-]")) {
    const spans = e.querySelectorAll(":scope > span:nth-of-type(2) > span");
    const sub = spans[1];
    if (sub) { const lh = parseFloat(getComputedStyle(sub).lineHeight) || 16; lines[e.dataset.testid.replace("lpk-tile-", "")] = Math.round(sub.getBoundingClientRect().height / lh); }
  }
  return {
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    beta: BETA.test(document.body.innerText),
    cut, lines,
    smallTiles: tiles.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.dataset.testid),
  };
}

(async () => {
  const b = await chromium.launch();
  let bad = 0;
  const rows = [];
  async function one(state, lang, w, width, height, dark, shot) {
    const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: shot ? 2 : 1 });
    await p.goto(`${BASE}?state=${state}&lang=${encodeURIComponent(lang)}${dark ? "&dark=1" : ""}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    const m = await p.evaluate(measure);
    const problems = [];
    if (m.sideScroll > 0) problems.push("sideways scroll");
    if (m.beta) problems.push("Beta on the page");
    if (m.cut.length) problems.push(`cut: ${m.cut.join(",")}`);
    if (m.smallTiles.length) problems.push(`tile < 44px: ${m.smallTiles.join(",")}`);
    if (problems.length) bad++;
    rows.push(`${problems.length ? "PROBLEM" : "ok     "} ${state.padEnd(8)} ${lang.padEnd(5)} ${w.padEnd(4)}${dark ? " dark" : "     "} lines=${JSON.stringify(m.lines)} ${problems.join("; ")}`);
    if (shot) await p.screenshot({ path: path.join(OUT, `${state}_${lang}_${w}${dark ? "_dark" : ""}.png`) });
    await p.close();
  }
  for (const state of STATES) {
    for (const [w, width, height] of WIDTHS) await one(state, "en", w, width, height, false, true);
    await one(state, "en", "390", 390, 844, true, true);
    for (const lang of LANGS.filter((l) => l !== "en")) await one(state, lang, "360", 360, 780, false, lang === "th" || lang === "vi");
  }
  await b.close();
  const text = rows.join("\n") + (bad ? `\n\n${bad} with a problem` : "\n\nall: no sideways scroll, nothing cut, no Beta word on the page, tiles ≥ 44 px");
  console.log(text);
  fs.writeFileSync(path.join(__dirname, "..", "fit-check.txt"), text + "\n");
  process.exit(bad ? 1 : 0);
})();
