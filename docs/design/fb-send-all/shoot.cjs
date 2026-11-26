// The REAL app (preview mode, made-up seller and buyers) for FB-2 "Send all in Messenger":
//   1) Settings → Invoicing → Facebook tab, a seller WITH the Receipt add-on (admin = sees it while the
//      switch is off): iPhone 390 (?ios=1), Android 360, laptop 1280; light + dark;
//   2) the same tab while a job runs (iPhone 390);
//   3) ✎ View with the REAL server picture (server/receiptDraw.js + the Send all words, the same function
//      the job sends) — iPhone 390 light, Android 360 dark, laptop 1280;
//   4) the "How" steps (iPhone 390).
// The server's three answers (/fb/access, /fb/sendall/status, /fb/sendall/preview) are played by the
// script; the picture is drawn by the server's own code from the same rows the preview database holds.
// Plus measured checks at 360 / 390 / 430 / 1280 in all 8 languages: nothing wider than the screen, the
// big button ≥ 44 px and its text not cut, every row's Send / View tap area ≥ 44 px.
//   server:  npx vite --config vite.preview.config.ts --port 5199
//   node docs/design/fb-send-all/shoot.cjs [port]
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
const LIST = [{ n: 7, tag: "sent", at: "2026-11-26T09:04:00.000Z" }, { n: 8, tag: "not_sent" }, { n: 9, tag: "other_app" }, { n: 10, tag: "not_sent" }, { n: 11, tag: "cant_message" }, { n: 12, tag: "not_sent" }];
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
  await p.goto(`http://localhost:${port}/?ivc=6,2&fbsa=1&admin=1${ios ? "&ios=1" : ""}`, { waitUntil: "networkidle" });
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
const measure = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const wide = document.documentElement.scrollWidth > vw + 1;
  const out = [...document.querySelectorAll("[data-testid=ivc-fb] *")].some((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); });
  const big = document.querySelector("[data-testid=ivc-fb-send-all]") || document.querySelector("[data-testid=ivc-fb-sending]");
  const bb = big ? big.getBoundingClientRect() : { height: 0 };
  const cut = big ? big.scrollWidth > big.clientWidth + 1 : true;
  // a .sfl-tap44 button's tap area: its own box grown to 44 by the ::after (redesign.css)
  const small = [...document.querySelectorAll("[data-testid=ivc-fb-row-send],[data-testid=ivc-fb-row-view],[data-testid^=ivc-fb-filter-],[data-testid=ivc-fb-how]")].filter((x) => {
    const r = x.getBoundingClientRect();
    return x.classList.contains("sfl-tap44") ? false : r.height < 44;
  }).map((x) => x.getAttribute("data-testid"));
  const tap44 = [...document.querySelectorAll("[data-testid=ivc-fb] .sfl-tap44")].every((x) => getComputedStyle(x, "::after").height === "44px");
  const tags = [...document.querySelectorAll("[data-testid=ivc-fb-row-tag]")].some((e) => e.getBoundingClientRect().right > vw + 0.5);
  return { wide, out, bigH: Math.round(bb.height), cut, small, tap44, tags };
});

(async () => {
  const b = await chromium.launch();
  const lines = [];
  const DEV = [["iphone390", 390, 844, { ios: true }], ["android360", 360, 800, { android: true }], ["laptop1280", 1280, 860, {}]];
  // 1) the tab
  for (const [name, w, h, o] of DEV) for (const theme of ["light", "dark"]) {
    const { p, errs, ctx } = await open(b, { w, h, theme, ...o });
    await toFbTab(p);
    await p.screenshot({ path: path.join(OUT, `fb_tab_${name}_${theme}.png`), fullPage: true });
    const m = await measure(p);
    lines.push(`tab ${name} ${theme}: wide=${m.wide} out=${m.out} bigButtonH=${m.bigH} cut=${m.cut} under44=${m.small.join(",") || "none"} tap44=${m.tap44} errors=${errs.length}`);
    await ctx.close();
  }
  // 2) while a job runs
  {
    const { p, ctx } = await open(b, { w: 390, h: 844, ios: true, running: true });
    await toFbTab(p);
    await p.screenshot({ path: path.join(OUT, "fb_running_iphone390_light.png"), fullPage: true });
    lines.push(`running iphone390: button="${await p.locator("[data-testid=ivc-fb-sending]").textContent()}"`);
    await ctx.close();
  }
  // 3) ✎ View with the server's picture
  for (const [name, w, h, o, theme, n] of [["iphone390", 390, 844, { ios: true }, "light", 9], ["android360", 360, 800, { android: true }, "dark", 10], ["laptop1280", 1280, 860, {}, "light", 9]]) {
    const { p, ctx } = await open(b, { w, h, theme, ...o });
    await toFbTab(p);
    await p.evaluate((num) => document.querySelector(`[data-testid=ivc-fb-row][data-buyer="${num}"] [data-testid=ivc-fb-row-view]`).click(), n);
    await p.waitForSelector("[data-testid=ivc-fb-pic]");
    await wait(p, 600);
    await p.screenshot({ path: path.join(OUT, `fb_view_${name}_${theme}.png`) });
    const m = await p.evaluate(() => {
      const img = document.querySelector("[data-testid=ivc-fb-pic]");
      const btns = [...document.querySelectorAll("[data-testid=ivc-fb-sheet] button")].map((x) => [x.getAttribute("data-testid"), Math.round(x.getBoundingClientRect().height)]);
      return { natural: `${img.naturalWidth}x${img.naturalHeight}`, btns };
    });
    lines.push(`view ${name} ${theme}: picture=${m.natural} buttons=${m.btns.map(([k, hh]) => `${k}:${hh}`).join(" ")}`);
    await ctx.close();
  }
  // 4) How
  {
    const { p, ctx } = await open(b, { w: 390, h: 844, ios: true });
    await toFbTab(p);
    await tap(p, "[data-testid=ivc-fb-how]");
    await wait(p, 400);
    await p.screenshot({ path: path.join(OUT, "fb_how_iphone390_light.png") });
    await ctx.close();
  }
  // 5) measured, all languages
  for (const w of [360, 390, 430, 1280]) for (const lang of LANGS) {
    const { p, errs, ctx } = await open(b, { w, h: 860, lang });
    await toFbTab(p);
    const m = await measure(p);
    if (w === 360 && lang !== "en") await p.screenshot({ path: path.join(OUT, `lang_360_${lang}.png`), fullPage: true });
    const ok = !m.wide && !m.out && m.bigH >= 44 && !m.cut && m.small.length === 0 && m.tap44 && !m.tags && errs.length === 0;
    lines.push(`${w} ${lang}: ${ok ? "ok" : "PROBLEM"} wide=${m.wide} out=${m.out} bigButtonH=${m.bigH} cut=${m.cut} under44=${m.small.join(",") || "none"} errors=${errs.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, "measured.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  await b.close();
})();
