// Pictures of the REAL Settings → Website screen in every Copy / Save state, at iPhone 390, Android 412 and
// laptop 1280 (+ the green / red states in the dark theme).
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5199 --strictPort
//      (2) node docs/design/button-feedback/harness/shoot.cjs
const { chromium, devices } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "shots");
const BASE = "http://localhost:5199/docs/design/button-feedback/harness/index.html";
const VIEWS = [["iphone390", { ...devices["iPhone 13"], deviceScaleFactor: 2 }], ["android412", { ...devices["Pixel 7"], deviceScaleFactor: 2 }], ["laptop1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }]];
// [name, save mode, clipboard allowed, steps]
const STATES = [
  ["1-opened_copy_and_saved", "ok", true, []],
  ["2-copied", "ok", true, ["copy"]],
  ["3-copy-refused", "ok", false, ["copy"]],
  ["4-changed_save", "ok", true, ["edit"]],
  ["5-saving", "slow", true, ["edit", "save"]],
  ["6-saved", "ok", true, ["edit", "save", "wait-saved"]],
  ["7-save-failed", "fail", true, ["edit", "save", "wait-failed"]],
];
async function shot(browser, name, vn, dev, mode, allowed, steps, theme) {
  const ctx = await browser.newContext({ ...dev, locale: "en-US" });
  const page = await ctx.newPage();
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route("**/fonts.gstatic.com/**", (r) => r.abort());
  await page.addInitScript((ok) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (s) => (ok ? Promise.resolve(void (window.__copied = s)) : Promise.reject(new Error("NotAllowedError"))) } });
    document.execCommand = () => false;
  }, allowed);
  await page.goto(`${BASE}?save=${mode}&theme=${theme}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="wed-save"]');
  for (const s of steps) {
    if (s === "copy") await page.click('[data-testid="wed-copy"]');
    if (s === "edit") { await page.fill('[data-testid="wed-name"]', "Demo Shop Taipei"); await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }); }
    if (s === "save") await page.click('[data-testid="wed-save"]');
    if (s === "wait-saved") await page.waitForSelector('[data-testid="wed-save"][data-state="done"]');
    if (s === "wait-failed") await page.waitForSelector('[data-testid="wed-save"][data-state="failed"]');
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="wed-save"]'), c = document.querySelector('[data-testid="wed-copy"]');
    const r = (el) => { const q = el.getBoundingClientRect(); return `${Math.round(q.width)}x${Math.round(q.height)}`; };
    return { save: `${b.textContent} [${b.dataset.state}${b.disabled ? ", off" : ""}] ${r(b)}`, copy: `${c.textContent} [${c.dataset.state}] ${r(c)}`, note: !!document.querySelector('[data-testid="wed-copy-fail"]'), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  await page.screenshot({ path: path.join(OUT, `${name}_${vn}${theme === "dark" ? "_dark" : ""}.png`) });
  await ctx.close();
  return `${(name + (theme === "dark" ? " (dark)" : "")).padEnd(34)} ${vn.padEnd(11)} copy="${info.copy}"  save="${info.save}"  note=${info.note}  sideways=${info.sideways}`;
}
(async () => {
  const browser = await chromium.launch(); const lines = [];
  for (const [name, mode, allowed, steps] of STATES) for (const [vn, dev] of VIEWS) lines.push(await shot(browser, name, vn, dev, mode, allowed, steps, "light"));
  for (const i of [1, 2, 5, 6]) { const [name, mode, allowed, steps] = STATES[i]; lines.push(await shot(browser, name, VIEWS[0][0], VIEWS[0][1], mode, allowed, steps, "dark")); }
  await browser.close();
  console.log(lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
