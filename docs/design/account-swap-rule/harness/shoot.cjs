// node docs/design/account-swap-rule/harness/shoot.cjs
//   (dev server first: npx vite --config vite.preview.config.ts --port 5199)
// The changed sheets of the 4-hour rule (sql/205) at 360 / 390 / 430 / 1280 px wide, dark at 390, and in all
// 8 languages at 360 (the longest texts). Each picture is checked: the right state and words, no sideways
// scroll, the sheet fully on screen, nothing cut off at the side, buttons ≥ 44 px, no plan words on iPhone.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [["360", 360, 780], ["390", 390, 844], ["430", 430, 932], ["1280", 1280, 800]];
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const BASE = "http://localhost:5199/docs/design/account-swap-rule/harness/index.html";
// [name, query, taps, checks]
const SHOTS = [
  ["1-list-new-note", "view=popup&state=one", [], { phase: "list", note: /right away/ }],
  ["2-confirm-remove", "view=popup&state=one", ["pf-remove"], { phase: "confirm", lead: /right away\. After that, it can't be changed again for 4 hours\.$/ }],
  ["3-removed-add-now", "view=popup&state=one", ["pf-remove", "pf-confirm-remove"], { phase: "room", lead: /^Removed\. You can add the new account now\.$/, noCountdown: true }],
  ["4-locked-wait", "view=popup&state=locked", ["pf-remove"], { phase: "wait", locked: /replaced another account less than 4 hours ago/, countdown: /^3h (29|30)m$/ }],
  ["5-two-accounts-one-locked", "view=popup&state=two", [], { phase: "list" }],
  ["6-held-place-wait", "view=popup&state=held", [], { phase: "wait", lead: /^An account was changed less than 4 hours ago\./, countdown: /^3h (29|30)m$/ }],
  ["2-confirm-remove_iphone", "view=popup&state=one&ios=1", ["pf-remove"], { phase: "confirm", ios: true }],
  ["4-locked-wait_iphone", "view=popup&state=locked&ios=1", ["pf-remove"], { phase: "wait", ios: true, countdown: /^3h (29|30)m$/ }],
  ["7-shops-list-new-note", "view=shops&state=list", [], { shopsNote: /right away/ }],
  ["8-shops-locked-wait", "view=shops&state=locked", ["ss-remove"], { ssLocked: /^3h (29|30)m$/ }],
];

function measure() {
  const one = (s) => document.querySelector(`[data-testid=${s}]`);
  const all = (s) => Array.from(document.querySelectorAll(s));
  const txt = (s) => (one(s) ? one(s).textContent : null);
  const sheet = one("pf-sheet") || one("ss-locked") || one("ss-confirm");
  const sr = sheet && sheet.getBoundingClientRect();
  const buttons = all("[data-testid=pf-remove],[data-testid=ss-remove],[data-testid=pf-upgrade],[data-testid=pf-contact],[data-testid=pf-cancel],[data-testid=pf-confirm-remove],[data-testid=pf-keep],[data-testid=pf-ok],[data-testid=pf-back],[data-testid=ss-locked-ok]");
  return {
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cutOff: all("[data-testid^=pf-],[data-testid^=ss-]").filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1); }).length,
    phase: one("pf-sheet") ? one("pf-sheet").dataset.phase : null,
    sheetOnScreen: sr ? sr.top >= 0 && sr.bottom <= window.innerHeight + 1 && sr.left >= 0 && sr.right <= window.innerWidth + 1 : null,
    lead: txt("pf-lead"), locked: txt("pf-lead-locked"), note: txt("pf-note"), countdown: txt("pf-countdown"),
    shopsNote: txt("ss-lock-note"), ssLocked: txt("ss-locked-countdown"), ssLead: txt("ss-locked-lead"),
    all: sheet ? sheet.textContent : "",
    smallButtons: buttons.filter((e) => Math.round(e.getBoundingClientRect().height) < 44).length,
  };
}

(async () => {
  const b = await chromium.launch();
  let bad = 0; const lines = [];
  const run = async (name, qs, taps, want, w, width, height, dark, lang) => {
    const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await p.goto(`${BASE}?${qs}${dark ? "&dark=1" : ""}&lang=${lang}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(450);
    for (const t of taps) { await p.click(`[data-testid=${t}]`); await p.waitForTimeout(350); }
    const m = await p.evaluate(measure);
    const problems = [];
    if (m.sideScroll > 0) problems.push("sideways scroll");
    if (m.cutOff) problems.push(`${m.cutOff} cut off at the side`);
    if (m.sheetOnScreen === false) problems.push("sheet off screen");
    if (m.smallButtons) problems.push(`${m.smallButtons} button(s) < 44 px`);
    if (want.phase && m.phase !== want.phase) problems.push(`phase ${m.phase}`);
    if (lang === "en") {
      for (const k of ["lead", "locked", "note", "countdown", "shopsNote", "ssLocked"]) if (want[k] && !want[k].test(m[k] || "")) problems.push(`${k}: ${m[k]}`);
      if (want.noCountdown && m.countdown) problems.push("a countdown after the first swap");
      if (want.ios && /plan|upgrade|price|subscri|\bpay/i.test(m.all)) problems.push("plan words on iPhone");
    } else {
      if (want.countdown && !m.countdown) problems.push("no countdown");
      if (want.ssLocked && !m.ssLocked) problems.push("no countdown");
    }
    if (problems.length) bad++;
    const file = `${name}_${lang === "en" ? "" : lang + "_"}${w}${dark ? "_dark" : ""}.png`;
    await p.screenshot({ path: path.join(OUT, file) });
    const line = `${problems.length ? "PROBLEM " + problems.join(", ") : "ok     "} ${file}  ${JSON.stringify({ phase: m.phase, countdown: m.countdown || m.ssLocked })}`;
    lines.push(line); console.log(line);
    await p.close();
  };
  for (const [name, qs, taps, want] of SHOTS) for (const [w, width, height] of WIDTHS) for (const dark of [false, true]) {
    if (dark && w !== "390") continue;
    if (name.endsWith("_iphone") && w === "1280") continue;   // the iPhone app is never 1280 wide
    await run(name, qs, taps, want, w, width, height, dark, "en");
  }
  // every language at the narrowest phone: the confirm (the longest new text) and the two "Wait a little" sheets
  for (const lang of LANGS.slice(1)) for (const i of [1, 3, 5, 9]) { const [name, qs, taps, want] = SHOTS[i]; await run(name, qs, taps, want, "360", 360, 780, false, lang); }
  await b.close();
  const end = bad ? `\n${bad} picture(s) with a problem` : `\nall ${lines.length} pictures: right state and words, no sideways scroll, sheets on screen, nothing cut off, buttons ≥ 44 px`;
  console.log(end);
  fs.writeFileSync(path.join(OUT, "checks.txt"), lines.join("\n") + end + "\n");
  process.exit(bad ? 1 : 0);
})();
