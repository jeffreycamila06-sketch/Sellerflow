// node docs/design/free-no-account-lock/harness/shoot.cjs
//   (dev server first: npx vite --config vite.preview.config.ts --port 5199)
// Free plan, no 4-hour lock (sql/216): Manage TikTok channels, the "Plan full" popup and the Shopee shops screen
// at iPhone (390), Android (360, 412, 430) and laptop (1280) widths, dark at 390, + a paid seller for comparison.
// Each picture is checked: the right buttons, NO lock words for the free seller, no sideways scroll, nothing cut off.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [["android-360", 360, 780], ["iphone-390", 390, 844], ["android-412", 412, 915], ["android-430", 430, 932], ["laptop-1280", 1280, 800]];
const BASE = "http://localhost:5199/docs/design/free-no-account-lock/harness/index.html";
const LOCK_WORDS = /LOCKED|Locked\.|Unlock in|Wait a little|4 hours|4 na oras/;
const typeName = async (p, name) => { const i = p.locator("input:not([disabled])").first(); await i.fill(name); };
// [name, query, steps, checks]
const SHOTS = [
  ["1-manage-free", "view=manage&plan=free&fnl=free&quota=1,1", [], { change: true, free: true }],
  ["2-manage-free-change-tapped", "view=manage&plan=free&fnl=free&quota=1,1", [["tap", "mc-change"]], { editable: true, free: true }],
  ["3-manage-free-after-saving-a-new-name", "view=manage&plan=free&fnl=free&quota=1,1", [["tap", "mc-change"], ["type", "newshop.ph"], ["text", "Save profile"], ["wait", 500]], { change: true, free: true, name: "newshop.ph" }],
  ["4-manage-free-second-change-right-away", "view=manage&plan=free&fnl=free&quota=1,1", [["tap", "mc-change"], ["type", "newshop.ph"], ["text", "Save profile"], ["wait", 500], ["tap", "mc-change"], ["type", "thirdshop.ph"], ["text", "Save profile"], ["wait", 500]], { change: true, free: true, name: "thirdshop.ph" }],
  ["5-manage-paid-for-comparison", "view=manage&plan=basic&fnl=paid&quota=1,1", [], { paidLocked: true }],
  ["6-planfull-free-list", "view=popup&plan=free", [], { free: true, phase: "list", remove: true }],
  ["7-planfull-free-remove-question", "view=popup&plan=free", [["tap", "pf-remove"]], { free: true, phase: "confirm" }],
  ["8-planfull-free-live-account", "view=popup&plan=free&live=1", [], { free: true, phase: "list", endLive: true }],
  ["9-shops-free", "view=shops&plan=free&quota=1,1", [], { free: true }],
];

function measure() {
  const one = (s) => document.querySelector(`[data-testid=${s}]`);
  const all = (s) => Array.from(document.querySelectorAll(s));
  return {
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cutOff: all("button, input, [data-testid]").filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1); }).length,
    change: !!one("mc-change"),
    changeBox: one("mc-change") ? (() => { const r = one("mc-change").getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })() : null,
    editable: all("input").some((i) => !i.disabled && i.value),
    values: all("input").map((i) => i.value).filter(Boolean),
    phase: one("pf-sheet") ? one("pf-sheet").dataset.phase : null,
    remove: !!one("pf-remove") || !!one("ss-remove"), endLive: !!one("pf-end-live"),
    text: document.body.innerText,
  };
}

(async () => {
  const b = await chromium.launch();
  let bad = 0; const lines = [];
  for (const [name, qs, steps, want] of SHOTS) for (const [w, width, height] of WIDTHS) for (const dark of [false, true]) {
    if (dark && w !== "iphone-390") continue;
    const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await p.goto(`${BASE}?${qs}${dark ? "&dark=1" : ""}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    for (const [kind, v] of steps) {
      if (kind === "tap") await p.click(`[data-testid=${v}]`);
      else if (kind === "text") await p.getByText(v, { exact: true }).click();
      else if (kind === "type") await typeName(p, v);
      else await p.waitForTimeout(v);
      await p.waitForTimeout(250);
    }
    const m = await p.evaluate(measure);
    const problems = [];
    if (m.sideScroll > 0) problems.push("sideways scroll");
    if (m.cutOff) problems.push(`${m.cutOff} cut off at the side`);
    if (want.free && LOCK_WORDS.test(m.text)) problems.push(`lock words: ${(LOCK_WORDS.exec(m.text) || [])[0]}`);
    if (want.change && !m.change) problems.push("no Change button");
    if (want.editable && !m.editable) problems.push("the name is not editable");
    if (want.name && !m.values.includes(want.name)) problems.push(`name is ${m.values.join("|")}`);
    if (want.phase && m.phase !== want.phase) problems.push(`phase ${m.phase}`);
    if (want.remove && !m.remove) problems.push("no Remove");
    if (want.endLive && (!m.endLive || m.remove)) problems.push("live account: no 'End your live first' / a Remove button");
    if (want.paidLocked && (!/Unlock in 3h (29|30)m/.test(m.text) || m.change)) problems.push("paid: no 'Unlock in' / a Change button");
    if (problems.length) bad++;
    const file = `${name}_${w}${dark ? "_dark" : ""}.png`;
    await p.screenshot({ path: path.join(OUT, file) });
    const line = `${problems.length ? "PROBLEM " + problems.join(", ") : "ok     "} ${file}${m.changeBox ? `  Change button ${m.changeBox}px` : ""}`;
    lines.push(line); console.log(line);
    await p.close();
  }
  await b.close();
  const end = bad ? `\n${bad} picture(s) with a problem` : `\nall ${lines.length} pictures: right buttons, no lock words for the free seller, no sideways scroll, nothing cut off`;
  console.log(end);
  fs.writeFileSync(path.join(OUT, "checks.txt"), lines.join("\n") + end + "\n");
  process.exit(bad ? 1 : 0);
})();
