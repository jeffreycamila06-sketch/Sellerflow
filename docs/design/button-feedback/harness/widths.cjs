// Measures the same Website screen states at 360 and 430 px (the two other phone widths of the project rule):
// button sizes and whether the page scrolls sideways. Run after the vite server of shoot.cjs is up.
const { chromium } = require("playwright");
const BASE = "http://localhost:5199/docs/design/button-feedback/harness/index.html";
const STATES = [["opened", "ok", true, []], ["copied", "ok", true, ["copy"]], ["copy-refused", "ok", false, ["copy"]], ["changed", "ok", true, ["edit"]], ["saving", "slow", true, ["edit", "save"]], ["saved", "ok", true, ["edit", "save", "done"]], ["save-failed", "fail", true, ["edit", "save", "failed"]]];
(async () => {
  const browser = await chromium.launch(); const out = [];
  for (const w of [360, 430]) for (const [name, mode, allowed, steps] of STATES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.route("**/fonts.g*/**", (r) => r.abort());
    await page.addInitScript((ok) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => (ok ? Promise.resolve() : Promise.reject(new Error("no"))) } });
      document.execCommand = () => false;
    }, allowed);
    await page.goto(`${BASE}?save=${mode}&theme=light`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="wed-save"]');
    for (const s of steps) {
      if (s === "copy") await page.click('[data-testid="wed-copy"]');
      if (s === "edit") { await page.fill('[data-testid="wed-name"]', "Demo Shop Taipei"); await page.evaluate(() => document.activeElement && document.activeElement.blur()); }
      if (s === "save") await page.click('[data-testid="wed-save"]');
      if (s === "done" || s === "failed") await page.waitForSelector(`[data-testid="wed-save"][data-state="${s}"]`);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(900); // past the screen's own opening animation
    const i = await page.evaluate(() => {
      const q = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return "-"; const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}${r.right > window.innerWidth + 0.5 || r.left < -0.5 ? " OUTSIDE" : ""}`; };
      const s = document.querySelector('[data-testid="wed-save"]');
      return { copy: q("wed-copy"), save: q("wed-save"), text: s.textContent, lines: Math.round(s.getBoundingClientRect().height), note: q("wed-copy-fail"), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    out.push(`${String(w).padEnd(4)} ${name.padEnd(13)} copy=${i.copy.padEnd(8)} save=${i.save.padEnd(8)} "${i.text}"  refused-note=${i.note}  sideways=${i.sideways}`);
    await ctx.close();
  }
  await browser.close(); console.log(out.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
