// The REAL app (preview mode, made-up seller and buyers) for the Invoicing → Facebook receipt EDITOR (sql/233):
//   1) the Facebook list with a saved edit (#3 "✎ Edited");
//   2) ✎ View on an unedited buyer = the same editor as Orders (fields + the live picture drawn on the phone);
//   3) a change typed → "✓ Saved" + Edited + Reset to original; the Reset question;
//   4) ✎ View on the edited buyer (#3).
// iPhone 390 (?ios=1) and laptop 1280, light; measured at 360 / 390 / 430 / 1280: nothing wider than the screen,
// the sheet's buttons ≥ 44 px.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/fb-invoice-edit/shoot.cjs [port]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const port = process.argv[2] || "5199";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const wait = (p, ms = 350) => p.waitForTimeout(ms);

// the preview database's Facebook buyers (src/dev/fakeSupabase.ts, ?ivc=6,2&fbsa=1): numbers 7–12
const ITEMS = [["A1 dress", 350], ["B2 top", 280], ["C3 bag", 120], ["D4 cap", 90], ["E5 belt", 60], ["F6 jeans", 420], ["G7 skirt", 260]];
const FB = {
  7: ["Maria Santos", [0]], 8: ["Joy Reyes", [1]], 9: ["Lea Santos", [2, 3]], 10: ["Kim Dela Cruz", [5]], 11: ["Rica Mendoza", [6]], 12: ["Nina Perez", [4]],
};
const rowsOf = (n) => FB[n][1].map((i, k) => ({ id: n * 10 + k, buyer_number: n, handle: FB[n][0], customer_name: FB[n][0], product: ITEMS[i][0], price: ITEMS[i][1], qty: 1, created_at: new Date(Date.UTC(2026, 10, 26, 5, n, k)).toISOString() }));
const LIST = [{ n: 1, tag: "sent", at: "2026-11-26T09:04:00.000Z" }, { n: 2, tag: "not_sent" }, { n: 3, tag: "not_sent" }, { n: 4, tag: "other_app" }, { n: 5, tag: "cant_message" }, { n: 6, tag: "not_sent" }];
const RUN = [{ n: 7, tag: "sent", at: "2026-11-26T09:04:00.000Z" }, { n: 8, tag: "sent", at: "2026-11-26T09:21:00.000Z" }, { n: 9, tag: "other_app" }, { n: 10, tag: "sending" }, { n: 11, tag: "cant_message" }, { n: 12, tag: "not_sent" }];

let draw = null, labels = null;
async function picture(n, lang, currency) {
  if (!draw) {
    ({ drawReceiptPng: draw } = await import("../../../server/receiptDraw.js"));
    ({ SEND_ALL_LABELS: labels } = await import("../../../server/fbSendAll.js"));
  }
  // the preview's saved format: the payment note + shipping fee 38 (fakeSupabase ?ivc)
  const png = await draw(rowsOf(n), { opening: "", note: "Pay by bank transfer within 24 hours.\nBank 012 · 0000-1234-5678", qrImage: null, shippingFee: 38, lang, currency, labels: labels[lang] || labels.en });
  return Buffer.from(png).toString("base64");
}

async function open(b, { w, h, theme = "light", lang = "en", ios = false, android = false, running = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([th, lg, and]) => {
    try { localStorage.setItem("sfl_rd_theme", th); localStorage.setItem("sfl_rd_lang", lg); } catch { /* nothing */ }
    window.open = () => null;
    if (and) window.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {} };
  }, [theme, lang, android]);
  await p.route("**/fb/access**", (r) => r.fulfill({ json: { ok: true, facebook: true, receipt: true } }));
  await p.route("**/fb/sendall/status**", (r) => r.fulfill({ json: running
    ? { ok: true, access: true, allowed: true, needsMessaging: false, buyers: RUN, job: { state: "running", oneBuyer: false, total: 6, sent: 2, skipped: 1, failed: 0, stop: null, startedAt: "2026-11-26T09:20:00.000Z", finishedAt: null } }
    : { ok: true, access: true, allowed: true, needsMessaging: false, buyers: LIST, job: null } }));
  await p.route("**/fb/sendall/preview**", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    r.fulfill({ json: { ok: true, png: await picture(Number(body.buyerNumber), body.lang, body.currency) } });
  });
  await p.route("**/fb/sendall/start**", (r) => r.fulfill({ json: { ok: true, already: false } }));
  await p.goto(`http://localhost:${port}/?ivc=0,0&fbsa=1&fbedit=1&admin=1${ios ? "&ios=1" : ""}`, { waitUntil: "networkidle" });
  await wait(p, 900);
  await p.evaluate(() => document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[target=_blank]"); if (a) e.preventDefault(); }, true));
  return { p, errs, ctx };
}
async function toFbTab(p) {
  for (let i = 0; i < 12 && !(await p.locator("[data-testid=tile-invoicing]").count()); i++) {
    await p.evaluate((k) => {
      const live = [...document.querySelectorAll("button")].filter((x) => /^(Live|直播|ไลฟ์|Лайв)$/i.test((x.textContent || "").trim()))[0];
      const menu = live ? [...live.parentElement.querySelectorAll("button")] : [];
      menu[menu.length - 1 - (k % Math.max(1, menu.length))]?.click();
    }, i);
    await wait(p, 400);
  }
  await tap(p, "[data-testid=tile-invoicing]");
  await p.waitForSelector("[data-testid=ivc-tab-facebook]");
  await tap(p, "[data-testid=ivc-tab-facebook]");
  await p.waitForSelector("[data-testid=ivc-fb-list]");
  await wait(p, 500);
}

const sheetScroll = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); el && el.scrollIntoView({ block: "center" }); }, sel);
const measureSheet = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const sheet = document.querySelector("[data-testid=ivc-fb-sheet]");
  const out = sheet ? [...sheet.querySelectorAll("*")].some((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }) : true;
  const small = sheet ? [...sheet.querySelectorAll("button")].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 39.5).map((x) => x.getAttribute("data-testid")) : [];
  return { wide: document.documentElement.scrollWidth > vw + 1, out, small };
});
(async () => {
  const b = await chromium.launch();
  const lines = [];
  for (const [name, w, h, o] of [["iphone390", 390, 844, { ios: true }], ["phone360", 360, 800, { android: true }], ["phone430", 430, 932, {}], ["laptop1280", 1280, 860, {}]]) {
    const shoot = name === "iphone390" || name === "laptop1280";
    const { p, errs, ctx } = await open(b, { w, h, ...o });
    await toFbTab(p);
    const snap = async (k, full = false) => { if (shoot) await p.screenshot({ path: path.join(OUT, `${k}_${name}.png`), fullPage: full }); };
    await sheetScroll(p, "[data-testid=ivc-fb-row][data-buyer=\"3\"]"); await wait(p);
    await snap("1-list-edited");
    const tag = await p.locator("[data-testid=ivc-fb-row][data-buyer=\"3\"] [data-testid=ivc-fb-row-edited]").textContent();
    // 2) unedited buyer #8
    await p.evaluate(() => document.querySelector('[data-testid=ivc-fb-row][data-buyer="2"] [data-testid=ivc-fb-row-view]').click());
    await p.waitForSelector("[data-testid=ivc-fb-editor]"); await p.waitForSelector("[data-testid=rs-picture]"); await wait(p, 500);
    await snap("2-view-top");
    await p.evaluate(() => { const s = document.querySelector("[data-testid=ivc-fb-sheet-scroll]"); s.scrollTop = s.scrollHeight; }); await wait(p, 300);
    await snap("3-view-picture");
    const m1 = await measureSheet(p);
    // 3) a change → saved
    await p.evaluate(() => { const s = document.querySelector("[data-testid=ivc-fb-sheet-scroll]"); s.scrollTop = 0; });
    await p.fill("[data-testid=ivc-fb-sheet] [data-testid=rs-price] >> nth=0", "250");
    await p.waitForSelector("[data-testid=ivc-fb-sheet-edited]", { timeout: 5000 }); await wait(p, 700);
    await snap("4-view-saved");
    await p.evaluate(() => document.querySelector("[data-testid=ivc-fb-reset]").click()); await wait(p);
    await sheetScroll(p, "[data-testid=ivc-fb-reset-ask]"); await wait(p);
    await snap("5-reset-ask");
    const m2 = await measureSheet(p);
    await p.evaluate(() => document.querySelector("[data-testid=ivc-fb-reset-no]").click());
    await p.evaluate(() => document.querySelector("[data-testid=ivc-fb-sheet-close]").click()); await wait(p, 600);
    // 4) the edited buyer #9
    await p.evaluate(() => document.querySelector('[data-testid=ivc-fb-row][data-buyer="3"] [data-testid=ivc-fb-row-view]').click());
    await p.waitForSelector("[data-testid=rs-picture]"); await wait(p, 500);
    await snap("6-view-edited");
    const tag8 = await p.evaluate(() => document.querySelector('[data-testid=ivc-fb-row][data-buyer="2"] [data-testid=ivc-fb-row-edited]')?.textContent || "");
    lines.push(`${name.padEnd(11)} row #3 tag="${tag}" · #2 after the change="${tag8}" · sheet: page wider=${m1.wide || m2.wide} items past the edge=${m1.out || m2.out} buttons under 40px=${[...m1.small, ...m2.small].join(",") || "none"} · errors=${errs.length}`);
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
