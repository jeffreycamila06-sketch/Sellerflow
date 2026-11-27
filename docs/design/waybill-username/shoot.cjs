// The REAL app (preview mode: src/dev/fakeSupabase.ts ?wb=ph|tw|off, fictional buyers) → Settings →
// SHIPPING → Shipping → Waybill username → upload the demo files → results → Pick the buyer.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   files:   WB_DUMP=<dir> npx vitest run src/redesign/adapters/__tests__/waybillDemo.dump.test.ts
//   run:     node docs/design/waybill-username/shoot.cjs <port> <demo dir> [only]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [, , port = "5199", demo, only] = process.argv;
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const CSV = path.join(demo, "All order-demo.csv");
const PDF = path.join(demo, "Shipping label-demo.pdf");
const DEVICES = [["iphone390", 390, 844], ["android412", 412, 915], ["phone360", 360, 780], ["phone430", 430, 932], ["laptop1280", 1280, 800]];
const lines = [];

async function open(b, w, h, q, theme) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  if (theme) await p.addInitScript((t) => { try { localStorage.setItem("sfl_rd_theme", t); } catch { /* */ } }, theme);
  await p.goto(`http://localhost:${port}/?${q}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.locator("button", { hasText: /^Settings$/ }).last().click();
  await p.waitForTimeout(600);
  return { p, errs };
}
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(p, name, full = false) {
  await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  lines.push(`${name}.png · sideways scroll ${await sideways(p)} px`);
}
async function toWaybill(p) {
  await p.click("[data-testid=tile-shiphub]");
  await p.waitForTimeout(400);
  await p.click("[data-testid=shub-waybill]");
  await p.waitForTimeout(600);
}
async function upload(p) {
  await p.setInputFiles("[data-testid=wb-csv-input]", CSV);
  await p.setInputFiles("[data-testid=wb-pdf-input]", PDF);
  await p.waitForSelector("[data-testid=wb-pdf-ok]", { timeout: 20000 });
  await p.waitForTimeout(500);
}

(async () => {
  const b = await chromium.launch();
  for (const [dev, w, h] of DEVICES) {
    if (only && !dev.startsWith(only)) continue;
    const { p, errs } = await open(b, w, h, "wb=ph");
    await shot(p, `${dev}_1_settings`);
    await p.click("[data-testid=tile-shiphub]"); await p.waitForTimeout(400);
    await shot(p, `${dev}_2_shipping_ph`);
    await p.click("[data-testid=shub-waybill]"); await p.waitForTimeout(600);
    await shot(p, `${dev}_3_upload_empty`);
    await upload(p);
    await shot(p, `${dev}_4_upload_ready`);
    await p.click("[data-testid=wb-go]"); await p.waitForTimeout(900);
    await shot(p, `${dev}_5_results`);
    const pick = p.locator("[data-testid^=wb-pick-]").first();
    if (await pick.count()) {
      await pick.click(); await p.waitForTimeout(500);
      await shot(p, `${dev}_6_pick_sheet`);
      await p.locator("[data-testid^=wb-cand-]").first().click(); await p.waitForTimeout(200);
      await shot(p, `${dev}_7_pick_selected`);
      await p.click("[data-testid=wb-sheet-use]"); await p.waitForTimeout(700);
      await shot(p, `${dev}_8_after_pick`);
    }
    if (errs.length) lines.push(`${dev}: PAGE ERRORS ${errs.join(" | ")}`);
    await p.close();
  }
  if (!only || only === "extra") {
    // Taiwan "Soon", the switch off, dark mode
    for (const [q, name, theme] of [["wb=tw", "tw", null], ["wb=off", "off", null], ["wb=ph", "dark", "dark"]]) {
      const { p, errs } = await open(b, 390, 844, q, theme);
      await shot(p, `iphone390_${name}_settings`);
      if (name !== "off") {
        await p.click("[data-testid=tile-shiphub]"); await p.waitForTimeout(400);
        await shot(p, `iphone390_${name}_shipping`);
      }
      if (name === "dark") {
        await p.click("[data-testid=shub-waybill]"); await p.waitForTimeout(500);
        await upload(p);
        await p.click("[data-testid=wb-go]"); await p.waitForTimeout(900);
        await shot(p, `iphone390_dark_results`);
        await p.locator("[data-testid^=wb-pick-]").first().click(); await p.waitForTimeout(500);
        await shot(p, `iphone390_dark_pick_sheet`);
      }
      if (errs.length) lines.push(`${name}: PAGE ERRORS ${errs.join(" | ")}`);
      await p.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, `shots-${only || "all"}.txt`), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
