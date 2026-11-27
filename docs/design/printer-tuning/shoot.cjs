// The REAL app (preview mode, made-up data) for Printer tuning (sql/230):
//   Admin → Manage sellers → a seller → Printer tuning   (?ptu=1&admin=1)
//   the seller's Printer setup card on Printer settings  (?ptu=1, a fake phone bridge with a saved AE241 printer)
// 390 (iPhone app) and 1280 (laptop), light + dark. Measured: nothing wider than the screen; buttons ≥ 44 px.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/printer-tuning/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const clickText = (p, re) => p.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll("button")].filter((x) => r.test((x.textContent || "").trim())).pop(); if (b) b.click(); return !!b; }, re.source);

async function ctxFor(b, w, h, theme, bridge) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/admin/tiktok-cooldown/status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{\"success\":false}" }));
  await p.addInitScript(({ th, bridge }) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); localStorage.setItem("sfl_rd_printer", JSON.stringify({ psType: "bt", psOut: "sticker", psSize: "60x40mm" })); } catch { /* */ }
    if (bridge) {
      const saved = { id: "b:AE", address: "AA:BB:CC:DD", name: "AE241-BT_C11D-LE", transport: "ble", model: "generic", lang: "tspl", paired: true };
      const ok = async () => ({ ok: true });
      window.SellerFlowPrinter = { getBluetoothLabelPrinter: async () => ({ ok: true, savedPrinter: saved }), scanBluetoothLabelPrinters: async () => ({ ok: true, printers: [] }), clearBluetoothLabelPrinter: ok, setBluetoothLabelPrinter: ok, getPrinter: async () => ({ ok: false }), printStickerNative: ok, printStickerBitmap: ok, printRawTspl: ok, printStickerImage: ok, getBuildNumber: () => 14 };
    }
  }, { th: theme, bridge });
  return { p, errs, ctx };
}
const measure = (p, sel) => p.evaluate((s) => {
  const vw = document.documentElement.clientWidth;
  const root = document.querySelector(s);
  const over = [...root.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > vw + 0.5).length;
  const small = [...root.querySelectorAll("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).map((b) => b.getAttribute("data-testid") || b.textContent);
  return { pageWide: document.documentElement.scrollWidth > vw + 1, over, small };
}, sel);

async function admin(b, w, h, theme, qs) {
  const { p, errs, ctx } = await ctxFor(b, w, h, theme, false);
  await p.goto(`http://localhost:${port}/?admin=1&ptu=1${qs}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 20 && !(await p.locator("[data-testid=adm-tuning-open]").count()); i++) {
    if (!(await p.locator("[data-testid=admin-ctrl-printertesters]").count())) await clickText(p, /^Admin$/);
    else await p.evaluate(() => { const d = [...document.querySelectorAll("div")].filter((x) => (x.textContent || "").trim() === "Sellers" && x.onclick !== undefined).pop(); d?.click(); });
    await wait(p, 500);
  }
  await p.evaluate(() => document.querySelector("[data-testid=adm-tuning-open]").click());
  await p.waitForSelector("[data-testid=ptu-printer]");
  await wait(p, 400);
  return { p, errs, ctx };
}
async function seller(b, w, h, theme, qs) {
  const { p, errs, ctx } = await ctxFor(b, w, h, theme, true);
  await p.goto(`http://localhost:${port}/?ptu=1${qs}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 25 && !(await p.locator("[data-testid=ps-tuning-card]").count()); i++) {
    if (!(await clickText(p, /^Printer settings|Bluetooth sticker/))) if (!(await clickText(p, /^General Settings/))) await clickText(p, /^Settings$/);
    await wait(p, 450);
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Printer/.test(x.textContent || "") && /Bluetooth|sticker|not set|Saved/i.test(x.textContent || "")); if (b) b.click(); });
    await wait(p, 450);
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /^Bluetooth/.test((x.textContent || "").trim())); if (b) b.click(); });
    await wait(p, 450);
  }
  await p.waitForSelector("[data-testid=ps-tuning-card]");
  await p.evaluate(() => document.querySelector("[data-testid=ps-tuning-card]").scrollIntoView({ block: "center" }));
  await wait(p, 400);
  return { p, errs, ctx };
}

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, w, h, qs] of [["iphone390", 390, 844, "&apk=1&ios=1"], ["phone360", 360, 800, "&apk=1"], ["phone430", 430, 932, "&apk=1"], ["laptop1280", 1280, 860, ""]]) {
    for (const theme of ["light", "dark"]) {
      const shoot = name === "iphone390" || name === "laptop1280";
      { // Admin
        const { p, errs, ctx } = await admin(b, w, h, theme, qs);
        if (shoot) await p.screenshot({ path: path.join(OUT, `admin_top_${name}_${theme}.png`) });
        await p.evaluate(() => document.querySelector("[data-testid=ptu-chip-cut_edge]").click()); await wait(p);
        await p.evaluate(() => document.querySelector("[data-testid=ptu-changes]").scrollIntoView({ block: "center" })); await wait(p);
        if (shoot) await p.screenshot({ path: path.join(OUT, `admin_chip-change_${name}_${theme}.png`) });
        await p.evaluate(() => document.querySelector("[data-testid=ptu-save]").click()); await wait(p);
        if (shoot) await p.screenshot({ path: path.join(OUT, `admin_save-question_${name}_${theme}.png`) });
        await p.evaluate(() => document.querySelector("[data-testid=ptu-save-ask-no]").click());
        await p.evaluate(() => document.querySelector("[data-testid=ptu-adv-toggle]").click()); await wait(p);
        await p.evaluate(() => document.querySelector("[data-testid=ptu-adv]").scrollIntoView({ block: "start" })); await wait(p);
        if (shoot) await p.screenshot({ path: path.join(OUT, `admin_advanced_${name}_${theme}.png`) });
        await p.evaluate(() => document.querySelector("[data-testid=ptu-undo]").scrollIntoView({ block: "center" })); await wait(p);
        if (shoot) await p.screenshot({ path: path.join(OUT, `admin_history_${name}_${theme}.png`) });
        const m = await measure(p, "[data-testid=ptu-sheet]");
        lines.push(`admin  ${name.padEnd(11)} ${theme.padEnd(5)} page wider than screen: ${m.pageWide} · items past the edge: ${m.over} · buttons under 44 px: ${m.small.length ? m.small.join(", ") : "none"} · errors: ${errs.length}`);
        await ctx.close();
      }
      { // Seller
        const { p, errs, ctx } = await seller(b, w, h, theme, qs);
        if (shoot) await p.screenshot({ path: path.join(OUT, `seller_card_${name}_${theme}.png`) });
        await p.evaluate(() => document.querySelector("[data-testid=ps-tester-print]").click()); await p.waitForSelector("[data-testid=ps-tester-question]"); await wait(p);
        await p.evaluate(() => document.querySelector("[data-testid=ps-tuning-card]").scrollIntoView({ block: "center" })); await wait(p);
        if (shoot) await p.screenshot({ path: path.join(OUT, `seller_question_${name}_${theme}.png`) });
        const m = await measure(p, "[data-testid=ps-tuning-card]");
        const txt = await p.evaluate(() => document.querySelector("[data-testid=ps-tuning-card]").textContent);
        lines.push(`seller ${name.padEnd(11)} ${theme.padEnd(5)} page wider than screen: ${m.pageWide} · items past the edge: ${m.over} · buttons under 44 px: ${m.small.length ? m.small.join(", ") : "none"} · setting names shown: ${/density|darkness|speed|gap|shift|flip|sensor/i.test(txt)} · errors: ${errs.length}`);
        await ctx.close();
      }
    }
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
