// node docs/design/shopee-connect-smooth/harness/shoot.cjs   (dev server first: npx vite --port 5199)
// The 4 states (+ the "another device" stop line) on iPhone 390×844, Android 412×915, laptop 1280×800,
// deviceScaleFactor 2. Checks each picture: no sideways scroll, the button text, the lines that must / must not show.
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const DEVICES = [["iphone-390x844", 390, 844], ["android-412x915", 412, 915], ["laptop-1280x800", 1280, 800]];
const STATES = [
  ["1-connecting", "connecting", { btn: "Connecting…", notice: null, note: false }],
  ["2-connected", "connected", { btn: "✓ Connected", notice: null, note: false }],
  ["3-stopped-ended", "ended", { btn: "Connect", notice: "Your Shopee live has ended.", note: false, empty: true }],
  ["3-stopped-other-device", "otherdevice", { btn: "Connect", notice: "Shopee was connected on another device.", note: false }],
  ["4-last-link", "lastlink", { btn: "Connect", notice: null, note: true }],
];
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [name, st, want] of STATES) for (const [label, w, h] of DEVICES) for (const dark of [false, true]) {
    if (dark && label !== "iphone-390x844") continue; // dark: one phone width is enough
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:5199/docs/design/shopee-connect-smooth/harness/index.html?state=${st}${dark ? "&dark=1" : ""}`, { waitUntil: "networkidle" });
    if (!["connecting", "connected"].includes(st)) {
      await p.click("[data-testid=lpk-tile-sh]");
      await p.waitForSelector("[data-testid=sh-link-form]");
      await p.waitForTimeout(1800);                      // the panel pops in 1.25 s after the tap, for 0.3 s
    } else {
      await p.waitForSelector("[data-testid=sh-link-form]");
      await p.waitForTimeout(300);
    }
    const m = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const btn = q("[data-testid=sh-link-connect]");
      const r = btn.getBoundingClientRect();
      return {
        sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        btn: btn.textContent, btnDisabled: btn.disabled, btnH: Math.round(r.height),
        notice: q("[data-testid=sh-link-notice]")?.textContent ?? null,
        note: !!q("[data-testid=sh-link-last-note]"),
        input: q("[data-testid=sh-link-input]").value,
        onScreen: r.bottom <= window.innerHeight && r.top >= 0,
      };
    });
    const problem = m.sideScroll > 0 || m.btn !== want.btn || m.notice !== want.notice || m.note !== want.note || m.btnH < 44
      || (want.empty ? m.input !== "" : m.input === "");
    if (problem) bad++;
    const file = `${name}_${label}${dark ? "_dark" : ""}.png`;
    await p.screenshot({ path: path.join(OUT, file) });
    console.log(problem ? "PROBLEM" : "ok     ", file, JSON.stringify({ ...m, input: m.input ? "(link)" : "" }));
    await p.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} picture(s) with a problem` : "\nall pictures: right button, right line, no sideways scroll, button ≥ 44 px");
  process.exit(bad ? 1 : 0);
})();
