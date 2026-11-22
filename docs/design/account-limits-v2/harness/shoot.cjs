// node docs/design/account-limits-v2/harness/shoot.cjs
//   (dev server first: npx vite --config vite.preview.config.ts --port 5199)
// The "Plan full" popup (5 states + Seller A + iPhone), Settings → Channels (four boxes; today's for comparison)
// and the Shopee shops screen, at 360 / 390 / 430 / 1280 px wide, deviceScaleFactor 2, dark at 390.
// Each picture is checked: no sideways scroll, the sheet on screen, buttons ≥ 44 px, the right button
// (Upgrade plan / Contact Admin), the right state; Channels: 2 boxes per row, one line per account (… when long).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [["360", 360, 780], ["390", 390, 844], ["430", 430, 932], ["1280", 1280, 800]];
const BASE = "http://localhost:5199/docs/design/account-limits-v2/harness/index.html";
const SHOTS = [
  ["popup-1-basic-one-account", "view=popup&state=basic1", { phase: "list", upgrade: true }],
  ["popup-2-confirm-remove", "view=popup&state=basic1", { tap: "[data-testid=pf-remove]", phase: "confirm" }],
  ["popup-3-two-accounts", "view=popup&state=plus2", { phase: "list", upgrade: true }],
  ["popup-4-wait-countdown", "view=popup&state=wait", { phase: "wait", countdown: true }],
  ["popup-5-live-account", "view=popup&state=live", { phase: "list", endLive: true, upgrade: true }],
  ["popup-6-not-covered-live-start", "view=popup&state=notcovered", { phase: "list", upgrade: true }],
  ["popup-1-basic-one-account_iphone", "view=popup&state=basic1&ios=1", { phase: "list", contact: true }],
  ["popup-3-two-accounts_iphone", "view=popup&state=plus2&ios=1", { phase: "list", contact: true }],
  ["popup-5-live-account_iphone", "view=popup&state=live&ios=1", { phase: "list", endLive: true, contact: true }],
  ["channels-preview-no-shopee-beta", "view=settings&state=ronald", { grid: true }],
  ["channels-shopee-beta", "view=settings&state=beta", { grid: true }],
  ["channels-admin", "view=settings&state=admin", { grid: true }],
  ["channels-today-everyone-else", "view=settings&state=today", { today: true }],
  ["shops-1-list", "view=shops&state=list&quota=3,3,0", { shops: 2 }],
  ["shops-2-confirm", "view=shops&state=list&quota=3,3,0", { shops: 2, tap: "[data-testid=ss-remove]", confirm: true }],
  ["shops-3-live", "view=shops&state=live&quota=3,3,0", { shops: 2, endLive: true }],
  ["shops-4-wait", "view=shops&state=wait&quota=3,3,1", { shops: 1, countdown: true }],
  ["shops-5-empty", "view=shops&state=empty&quota=1,3,0", { shops: 0 }],
];

function measure() {
  const one = (s) => document.querySelector(s);
  const all = (s) => Array.from(document.querySelectorAll(s));
  const h = (el) => Math.round(el.getBoundingClientRect().height);
  const sheet = one("[data-testid=pf-sheet]") || one("[data-testid=ss-confirm]");
  const sr = sheet && sheet.getBoundingClientRect();
  const tiles = all("button[data-testid]").filter((e) => /^cg-(tiktok|facebook|instagram|shopee)$/.test(e.dataset.testid));
  const top = (e) => Math.round(e.getBoundingClientRect().top);
  const buttons = "[data-testid=pf-remove],[data-testid=ss-remove],[data-testid=pf-upgrade],[data-testid=pf-contact],[data-testid=pf-cancel],[data-testid=pf-confirm-remove],[data-testid=pf-keep],[data-testid=ss-confirm-remove],[data-testid=ss-keep],[data-testid=pf-ok]";
  return {
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cutOff: all("[data-testid^=cg-],[data-testid^=pf-],[data-testid^=ss-]").filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1); }).length,
    phase: one("[data-testid=pf-sheet]") ? one("[data-testid=pf-sheet]").dataset.phase : null,
    sheetOnScreen: sr ? sr.top >= 0 && sr.bottom <= window.innerHeight + 1 && sr.left >= 0 && sr.right <= window.innerWidth + 1 : null,
    upgrade: !!one("[data-testid=pf-upgrade]"),
    contact: !!one("[data-testid=pf-contact]"),
    contactIsLink: one("[data-testid=pf-contact]") ? one("[data-testid=pf-contact]").tagName === "A" : false,
    endLive: !!(one("[data-testid=pf-end-live]") || one("[data-testid=ss-end-live]")),
    countdown: (one("[data-testid=pf-countdown]") || one("[data-testid=ss-wait]") || { textContent: null }).textContent,
    lead: (one("[data-testid=pf-lead]") || { textContent: "" }).textContent,
    title: (one("[data-testid=pf-title]") || { textContent: "" }).textContent,
    smallButtons: all(buttons).filter((e) => h(e) < 44).length,
    tiles: tiles.length,
    twoPerRow: tiles.length === 4 ? top(tiles[0]) === top(tiles[1]) && top(tiles[2]) === top(tiles[3]) && top(tiles[2]) > top(tiles[0]) : null,
    tileMinH: tiles.length ? Math.min.apply(null, tiles.map(h)) : null,
    lineOneRow: all("[data-testid$=-line]").every((e) => h(e) < 22),
    shops: all("[data-testid=ss-row]").length,
    quota: (one("[data-testid=account-quota-line]") || { textContent: null }).textContent,
    confirm: !!one("[data-testid=ss-confirm]"),
  };
}

function scrollToChannels() {
  const grid = document.querySelector("[data-testid=cg-grid]");
  const label = Array.from(document.querySelectorAll("div")).find((d) => /^channels$/i.test((d.textContent || "").trim()));
  const el = grid || label;
  const box = document.querySelector("[data-testid=harness-scroll]");
  if (el && box) box.scrollTop = Math.max(0, el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 70);
}

(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [name, qs, want] of SHOTS) for (const [w, width, height] of WIDTHS) for (const dark of [false, true]) {
    if (dark && w !== "390") continue;
    if (name.endsWith("_iphone") && w === "1280") continue; // the iPhone app is never 1280 wide
    const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await p.goto(`${BASE}?${qs}${dark ? "&dark=1" : ""}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    if (want.tap) { await p.click(want.tap); await p.waitForTimeout(400); }
    if (want.grid || want.today) { await p.evaluate(scrollToChannels); await p.waitForTimeout(700); }
    const m = await p.evaluate(measure);
    const problems = [];
    if (m.sideScroll > 0) problems.push("sideways scroll");
    if (m.cutOff) problems.push(`${m.cutOff} element(s) cut off at the side`);
    if (want.phase && m.phase !== want.phase) problems.push(`phase ${m.phase}`);
    if (m.sheetOnScreen === false) problems.push("sheet off screen");
    if (want.upgrade && (!m.upgrade || m.contact)) problems.push("not Upgrade plan");
    if (want.contact && (!m.contact || m.upgrade || !m.contactIsLink)) problems.push("not a Contact Admin link");
    if (want.contact && /plan|upgrade|price|subscri|pay/i.test(m.lead + m.title)) problems.push("plan words on iPhone");
    if (want.endLive && !m.endLive) problems.push("no End your live first");
    if (want.countdown && !/\b2h 1[45]m\b/.test(m.countdown || "")) problems.push(`countdown ${m.countdown}`);
    if (m.smallButtons) problems.push(`${m.smallButtons} button(s) < 44 px`);
    if (want.grid && (m.tiles !== 4 || !m.twoPerRow || m.tileMinH < 44 || !m.lineOneRow)) problems.push("grid layout");
    if (want.today && m.tiles !== 0) problems.push("grid on today's screen");
    if (want.shops !== undefined && m.shops !== want.shops) problems.push(`${m.shops} shop rows`);
    if (want.shops !== undefined && !m.quota) problems.push("no quota line");
    if (want.confirm && !m.confirm) problems.push("no confirm sheet");
    if (problems.length) bad++;
    const file = `${name}_${w}${dark ? "_dark" : ""}.png`;
    await p.screenshot({ path: path.join(OUT, file) });
    console.log(problems.length ? `PROBLEM ${problems.join(", ")}` : "ok     ", file, JSON.stringify({ phase: m.phase, countdown: m.countdown, tiles: m.tiles, shops: m.shops, quota: m.quota }));
    await p.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} picture(s) with a problem` : "\nall pictures: right state, right button, no sideways scroll, sheets on screen, buttons ≥ 44 px, 2 boxes per row");
  process.exit(bad ? 1 : 0);
})();
