// The REAL app (preview mode, made-up data): a printer tester on a LISTED (Admin-approved) printer.
//   Settings → Printer → Bluetooth → Scan → tap AE241-BT (approved) → Printer test card → ESC/POS → Test print
//   → "Did it print clean?" → Yes + photo → Send report → "Use this printer" → saved (green card).
// 390 (phone app) and 1280 (laptop). Measured: nothing wider than the screen; buttons ≥ 44 px.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/tester-all-models/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (p, ms = 350) => p.waitForTimeout(ms);
const clickText = (p, re) => p.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll("button")].filter((x) => r.test((x.textContent || "").trim())).pop(); if (b) b.click(); return !!b; }, re.source);
const tid = (p, id) => p.evaluate((i) => { const e = document.querySelector(`[data-testid=${i}]`); if (e) e.click(); return !!e; }, id);
const centre = (p, id) => p.evaluate((i) => document.querySelector(`[data-testid=${i}]`)?.scrollIntoView({ block: "center" }), id);

async function open(b, w, h, theme, qs) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ th }) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", "en"); localStorage.setItem("sfl_rd_printer", JSON.stringify({ psType: "bt", psOut: "sticker", psSize: "60x40mm" })); } catch { /* */ }
    const printers = [
      { id: "b:AE", address: "AA:BB:CC:01", name: "AE241-BT_C11D-LE", transport: "ble", model: "generic", likely: true },
      { id: "b:PT", address: "AA:BB:CC:02", name: "PT210L_30EF", transport: "ble", model: "generic", likely: true },
      { id: "b:D5", address: "AA:BB:CC:03", name: "D520BT-Z", transport: "ble", model: "D520BT", likely: true },
    ];
    let saved = null;
    const ok = async () => ({ ok: true });
    window.SellerFlowPrinter = {
      getBluetoothLabelPrinter: async () => ({ ok: true, savedPrinter: saved }), scanBluetoothLabelPrinters: async () => ({ ok: true, printers }),
      clearBluetoothLabelPrinter: async () => { saved = null; return { ok: true, savedPrinter: null }; },
      setBluetoothLabelPrinter: async (x) => { saved = { ...x, paired: true }; return { ok: true, savedPrinter: saved }; },
      getPrinter: async () => ({ ok: false }), printStickerNative: ok, printStickerBitmap: ok, printRawTspl: ok, printStickerImage: ok, testGenericPrinter: ok,
    };
  }, { th: theme });
  await p.goto(`http://localhost:${port}/?prt=1${qs}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  for (let i = 0; i < 25 && !(await p.locator("[data-testid=ps-scan]").count()); i++) {
    if (!(await clickText(p, /^Printer settings|Bluetooth sticker/))) if (!(await clickText(p, /^General Settings/))) await clickText(p, /^Settings$/);
    await wait(p, 450);
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Printer/.test(x.textContent || "") && /Bluetooth|sticker|not set|Saved/i.test(x.textContent || "")); if (b) b.click(); });
    await wait(p, 450);
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /^Bluetooth/.test((x.textContent || "").trim())); if (b) b.click(); });
    await wait(p, 450);
    await tid(p, "printer-guide-ok"); // the first-time Bluetooth guide
    await wait(p, 450);
  }
  return { p, errs, ctx };
}
const measure = (p, sel) => p.evaluate((s) => {
  const vw = document.documentElement.clientWidth;
  const root = document.querySelector(s) || document.body;
  const over = [...root.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > vw + 0.5).length;
  const small = [...root.querySelectorAll("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).map((b) => b.getAttribute("data-testid") || (b.textContent || "").trim().slice(0, 20));
  return { pageWide: document.documentElement.scrollWidth > vw + 1, over, small };
}, sel);

(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, w, h, qs] of [["phone390", 390, 844, "&apk=1"], ["phone360", 360, 800, "&apk=1"], ["phone430", 430, 932, "&apk=1"], ["laptop1280", 1280, 860, ""]]) {
    const shoot = name === "phone390" || name === "laptop1280";
    const { p, errs, ctx } = await open(b, w, h, "light", qs);
    const snap = async (step) => { if (shoot) await p.screenshot({ path: path.join(OUT, `${step}_${name}.png`) }); };
    await p.waitForSelector("[data-testid=ps-scan]"); await tid(p, "ps-scan");
    await p.waitForSelector("[data-testid=ps-v2-list]"); await centre(p, "ps-v2-list"); await wait(p);
    await snap("1-list");
    await p.evaluate(() => [...document.querySelectorAll("[data-testid=ps-row]")].find((x) => /AE241/.test(x.textContent || "")).click());
    await p.waitForSelector("[data-testid=ps-tester-card]"); await centre(p, "ps-tester-card"); await wait(p);
    await snap("2-card");
    const m1 = await measure(p, "[data-testid=ps-tester-card]");
    await tid(p, "ps-tester-lang-escpos"); await tid(p, "ps-tester-print");
    await p.waitForSelector("[data-testid=ps-tester-question]"); await tid(p, "ps-tester-yes"); await wait(p);
    await p.setInputFiles("[data-testid=ps-tester-photo-input]", { name: "sticker.jpg", mimeType: "image/png", buffer: fs.readFileSync(path.join(__dirname, "..", "..", "..", "public", "icon-180.png")) });
    await p.waitForSelector("[data-testid=ps-tester-photo-ok]"); await centre(p, "ps-tester-send"); await wait(p);
    await snap("3-question");
    await tid(p, "ps-tester-send");
    await p.waitForSelector("[data-testid=ps-tester-use]"); await centre(p, "ps-tester-card"); await wait(p);
    await snap("4-use");
    const m2 = await measure(p, "[data-testid=ps-tester-card]");
    await tid(p, "ps-tester-use");
    await p.waitForSelector("[data-testid=ps-saved]"); await centre(p, "ps-saved"); await wait(p);
    await snap("5-saved");
    const m3 = await measure(p, "body");
    for (const [step, m] of [["card", m1], ["use", m2], ["saved", m3]]) lines.push(`${name.padEnd(11)} ${step.padEnd(6)} page wider than screen: ${m.pageWide} · items past the edge: ${m.over} · buttons under 44 px: ${m.small.length ? m.small.join(", ") : "none"} · errors: ${errs.length}`);
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
